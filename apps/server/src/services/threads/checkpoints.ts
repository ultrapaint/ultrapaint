import type { NotConfigured } from "@ultrapaint/contracts/errors";
import { type ForbiddenPath, NotFound } from "@ultrapaint/contracts/errors";
import { Checkpoint, type GitDiff } from "@ultrapaint/contracts/git";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { EventBus } from "../../events.ts";
import { makeWalk } from "../../fs-walk.ts";
import { hashContent } from "../../hash.ts";
import { makeId } from "../../ids.ts";
import { ProjectManager } from "../../project.ts";
import { RepoPaths } from "../repo-paths.ts";
import { Storage } from "../storage.ts";
import { simpleDiff } from "./diff.ts";

const KEEP = 30;
const DESIGN_FILE_RE = /\.(tsx?|json|css|md)$/;

/**
 * Repo-relative path to content for every text file of the designs directory: what a checkpoint
 * and a snapshot keep. Images are left out; they are not in the undo journal either.
 */
export const makeDesignFiles = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  project: ProjectManager["Service"]
) => {
  const walk = makeWalk(fs, path);
  return project.use(
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const files = yield* walk(paths.designsDir, {
        includeFile: (name) => DESIGN_FILE_RE.test(name),
        skipDir: (name) => name === "node_modules" || name.startsWith("."),
      });
      const entries = yield* Effect.forEach(files, (abs) =>
        Effect.map(
          Effect.orElseSucceed(fs.readFileString(abs), () => ""),
          (content) => [paths.relative(abs), content] as const
        )
      );
      return Object.fromEntries(entries) as { [file: string]: string };
    })
  );
};

const Record = Schema.Struct({
  checkpoint: Checkpoint,
  files: Schema.Record(Schema.String, Schema.String),
  /**
   * The repository it was taken in. The state directory can serve several, one after the
   * other; a checkpoint is only seen in its own. Absent in one kept before it was recorded.
   */
  repo: Schema.optional(Schema.String),
});
type Record = typeof Record.Type;
const RecordJson = Schema.fromJsonString(Record);
const decodeRecord = Schema.decodeUnknownEffect(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);

/** Snapshots of the designs directory taken before each agent turn (ADR 0008). */
export class Checkpoints extends Context.Service<
  Checkpoints,
  {
    readonly create: (
      threadId: string,
      label: string
    ) => Effect.Effect<void, NotConfigured>;
    readonly diff: (
      id: string
    ) => Effect.Effect<GitDiff[], NotFound | NotConfigured>;
    /** What the checkpoint kept: repo-relative path to content. */
    readonly files: (
      id: string
    ) => Effect.Effect<{ readonly [file: string]: string }, NotFound>;
    readonly list: Effect.Effect<Checkpoint[]>;
    readonly revert: (
      id: string
    ) => Effect.Effect<void, NotFound | NotConfigured | ForbiddenPath>;
  }
>()("ultrapaint/server/Checkpoints") {
  static readonly layer = Layer.effect(
    Checkpoints,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const project = yield* ProjectManager;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // Asked for on every write: saving an unsaved session moves the state directory.
      const fileOf = (id: string) =>
        Effect.map(storage.stateDir, (state) =>
          path.join(state, "checkpoints", `${id}.json`)
        );
      const dir = path.join(yield* storage.stateDir, "checkpoints");
      const store = new Map<string, Record>();

      yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));
      const names = yield* Effect.orDie(fs.readDirectory(dir));
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        // A checkpoint that cannot be read is simply not offered.
        const record = yield* fs
          .readFileString(path.join(dir, name))
          .pipe(Effect.flatMap(decodeRecord), Effect.option);
        if (record._tag === "Some") {
          store.set(record.value.checkpoint.id, record.value);
        }
      }

      const designFiles = makeDesignFiles(fs, path, project);

      /** The open repository's root; null when none is open. */
      const openRepo = project
        .use(Effect.map(RepoPaths, (paths) => paths.root))
        .pipe(Effect.orElseSucceed(() => null));

      /** Whether a checkpoint belongs to the open repository, or says nothing of where it was taken. */
      const ours = (record: Record, repo: string | null) =>
        record.repo === undefined || record.repo === repo;

      const find = Effect.fnUntraced(function* (id: string) {
        const record = store.get(id);
        if (!(record && ours(record, yield* openRepo))) {
          return yield* new NotFound({ message: "unknown checkpoint" });
        }
        return record;
      });

      const create = Effect.fn("Checkpoints.create")(function* (
        threadId: string,
        label: string
      ) {
        const files = yield* designFiles;
        const repo = yield* openRepo;
        const record: Record = {
          checkpoint: {
            at: yield* Clock.currentTimeMillis,
            files: Object.keys(files),
            id: yield* makeId("cp"),
            label,
            threadId,
          },
          files,
          ...(repo !== null && { repo }),
        };
        store.set(record.checkpoint.id, record);
        yield* encodeRecord(record).pipe(
          Effect.flatMap((json) =>
            Effect.flatMap(fileOf(record.checkpoint.id), (file) =>
              writeAtomic(file, json)
            )
          ),
          Effect.orDie
        );
        const oldest = Array.from(store.values())
          .sort((a, b) => a.checkpoint.at - b.checkpoint.at)
          .slice(0, -KEEP);
        for (const old of oldest) {
          store.delete(old.checkpoint.id);
          yield* Effect.ignore(
            Effect.flatMap(fileOf(old.checkpoint.id), (file) =>
              fs.remove(file, { force: true })
            )
          );
        }
      });

      const diff = Effect.fn("Checkpoints.diff")(function* (id: string) {
        const record = yield* find(id);
        const current = yield* designFiles;
        const all = new Set([
          ...Object.keys(record.files),
          ...Object.keys(current),
        ]);
        const out: GitDiff[] = [];
        for (const file of all) {
          const before = record.files[file];
          const after = current[file];
          if (before !== after) {
            out.push({
              diff: simpleDiff(file, before ?? "", after ?? ""),
              path: file,
            });
          }
        }
        return out;
      });

      const revert = Effect.fn("Checkpoints.revert")(function* (id: string) {
        const record = yield* find(id);
        const current = yield* designFiles;
        const resolve = (file: string) =>
          project.use(
            Effect.flatMap(RepoPaths, (paths) => paths.resolve(file))
          );
        for (const [file, content] of Object.entries(record.files)) {
          if (current[file] !== content) {
            yield* Effect.orDie(writeAtomic(yield* resolve(file), content));
            yield* events.publish("file.changed", {
              file,
              hash: hashContent(content),
            });
          }
        }
        for (const file of Object.keys(current)) {
          if (!(file in record.files)) {
            yield* Effect.orDie(
              fs.remove(yield* resolve(file), { force: true })
            );
          }
        }
      });

      return Checkpoints.of({
        create,
        diff,
        files: (id) => Effect.map(find(id), (record) => record.files),
        list: Effect.map(openRepo, (repo) =>
          Array.from(store.values())
            .filter((r) => ours(r, repo))
            .map((r) => r.checkpoint)
            .sort((a, b) => b.at - a.at)
        ),
        revert,
      });
    })
  );
}
