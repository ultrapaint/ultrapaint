/**
 * The project's folder as files, without git: what is in it, and what changed between two looks
 * at it. Git is not needed for either (PLAN-desktop D9); `.gitignore` is read as git reads it, so
 * what git would leave out is left out here too.
 */
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { hashBytes } from "../hash.ts";
import { makeTreeWalk, type TreeEntry } from "../tree-walk.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";

/** The folder's files as `stat` saw them at one moment: path to time and size. */
export type TreeStamp = ReadonlyMap<string, TreeEntry>;

/** A file's contents as last hashed, and the time and size it had then. */
interface Known {
  readonly hash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

const sameStat = (a: TreeEntry, b: { mtimeMs: number; size: number }) =>
  a.mtimeMs === b.mtimeMs && a.size === b.size;

export class WorkingTree extends Context.Service<
  WorkingTree,
  {
    /**
     * Files of the folder git would keep, tracked or not, repo-relative and sorted. Installs,
     * builds, `.git` and the tool's state directory are never in it.
     */
    readonly files: Effect.Effect<readonly string[]>;
    /** Every file's time and size now: cheap, nothing is read. */
    readonly stamp: Effect.Effect<TreeStamp>;
    /**
     * Files added, removed or changed since `before`, sorted. Only the files whose time or size
     * moved are looked at; one whose size is the same is read, and left out when its content
     * is what it was last known to be.
     */
    readonly changedSince: (before: TreeStamp) => Effect.Effect<string[]>;
  }
>()("ultrapaint/server/WorkingTree") {
  static readonly layer = Layer.effect(
    WorkingTree,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const walk = makeTreeWalk(fs, path);
      /** Contents hashed before, by path: what lets a file touched but not changed be told. */
      const known = new Map<string, Known>();

      const entries = Effect.gen(function* () {
        // Asked each time: saving an unsaved session moves the state directory.
        const stateDir = yield* storage.stateDir;
        return yield* walk(paths.root, { skip: [stateDir] });
      });

      const stamp = Effect.map(
        entries,
        (list): TreeStamp => new Map(list.map((e) => [e.path, e]))
      ).pipe(Effect.withSpan("WorkingTree.stamp"));

      const hashOf = (entry: TreeEntry) =>
        fs.readFile(path.join(paths.root, entry.path)).pipe(
          Effect.map((bytes) => {
            const hash = hashBytes(bytes);
            known.set(entry.path, { ...entry, hash });
            return hash;
          }),
          // Gone between the look and the read: it changed.
          Effect.orElseSucceed(() => null)
        );

      const changedSince = Effect.fn("WorkingTree.changedSince")(function* (
        before: TreeStamp
      ) {
        const now = yield* stamp;
        const changed: string[] = [];
        const toRead: { entry: TreeEntry; was: Known }[] = [];
        for (const [file, entry] of now) {
          const old = before.get(file);
          if (!old) {
            changed.push(file);
          } else if (!sameStat(entry, old)) {
            const was = known.get(file);
            // Same size, and its content known from before: read it to see.
            if (entry.size === old.size && was && sameStat(old, was)) {
              toRead.push({ entry, was });
            } else {
              changed.push(file);
            }
          }
        }
        for (const file of before.keys()) {
          if (!now.has(file)) {
            changed.push(file);
          }
        }
        const reread = yield* Effect.forEach(
          toRead,
          ({ entry, was }) =>
            Effect.map(hashOf(entry), (hash) =>
              hash === was.hash ? null : entry.path
            ),
          { concurrency: 8 }
        );
        for (const file of reread) {
          if (file !== null) {
            changed.push(file);
          }
        }
        // What changed is hashed for next time, so a later touch is told from a change.
        const read = new Set(toRead.map((r) => r.entry.path));
        yield* Effect.forEach(
          changed.flatMap((file) => {
            const entry = now.get(file);
            return entry && !read.has(file) ? [entry] : [];
          }),
          hashOf,
          { concurrency: 8, discard: true }
        );
        return changed.sort();
      });

      return WorkingTree.of({
        changedSince,
        files: Effect.map(entries, (list) => list.map((e) => e.path)).pipe(
          Effect.withSpan("WorkingTree.files")
        ),
        stamp,
      });
    })
  );
}
