/**
 * The designs kept in the snapshot store: what a named snapshot (ADR 0019) and an agent turn's
 * checkpoint (ADR 0008) both are. Each kind is a namespace of the store, with one ref per point
 * kept, named by its id, whose note says what it is and the repository it was taken in. What is
 * written here once serves both: the design files as they are now, which refs the open
 * repository has, their diff with now, putting one back through the undo journal, and telling
 * the editor the open repository's list whenever a ref is kept or let go of, whoever did it.
 */
import { type NotConfigured, NotFound } from "@ultrapaint/contracts/errors";
import type { FileDiff } from "@ultrapaint/contracts/snapshots";
import { basename } from "@ultrapaint/shared/path";
import { Effect, FileSystem, Path, Schema } from "effect";
import { makeWalk } from "../fs-walk.ts";
import { newestFirst } from "../ids.ts";
import { OpenProject } from "../project.ts";
import { COMMENTS_FILE } from "./comments-file.ts";
import { EditService } from "./edit.ts";
import { simpleDiff } from "./file-diff.ts";
import { RepoPaths } from "./repo-paths.ts";
import { type Contents, SnapshotStore } from "./snapshot-store.ts";
import { Storage } from "./storage.ts";

const DESIGN_FILE_RE = /\.(tsx?|json|css|md)$/;

/**
 * Comments are the conversation about the designs, not the designs: nothing kept here keeps
 * them, and putting the designs back never puts old ones back.
 */
export const keepsFile = (file: string) => basename(file) !== COMMENTS_FILE;

/** What a note says of where it was taken: absent in one kept before it was recorded. */
interface Located {
  readonly repo?: string | undefined;
}

/** A point of the designs kept: its note, and the store's snapshot of its files. */
export type DesignRef<N> = N & { readonly tree: string };

export interface DesignRefsOptions<N extends Located, I> {
  /** The id the note gives its ref's name. */
  readonly idOf: (note: N) => string;
  /** How many are kept, of every repository together: past that, the oldest are let go of. */
  readonly keepLast?: number;
  /** One as the editor lists it, from its note. */
  readonly listed: (note: N) => I;
  readonly namespace: string;
  /** The note, as its ref keeps it. */
  readonly note: Schema.Codec<N, string>;
  /** Tells the editor the open repository's list, newest first: after every change to it. */
  readonly publish: (list: readonly I[]) => Effect.Effect<void>;
  /** What one is called in a message: "snapshot", "checkpoint". */
  readonly what: string;
}

/** The designs kept in one namespace of the snapshot store. */
export const makeDesignRefs = <
  N extends Located,
  I extends { readonly at: number; readonly id: string },
>(
  options: DesignRefsOptions<N, I>
) =>
  Effect.gen(function* () {
    const { idOf, listed, namespace, what } = options;
    const store = yield* SnapshotStore;
    const project = yield* OpenProject;
    const storage = yield* Storage;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const walk = makeWalk(fs, path);
    const decodeNote = Schema.decodeUnknownEffect(options.note);
    const encodeNote = Schema.encodeEffect(options.note);

    /**
     * Repo-relative path to content for every text file of the designs directory but the
     * comments: what is kept. Images are left out; they are not in the undo journal either.
     */
    const designFiles: Effect.Effect<
      { readonly [file: string]: string },
      NotConfigured
    > = project.use(
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
        return Object.fromEntries(entries.filter(([file]) => keepsFile(file)));
      })
    );

    /** The open repository's root; null when none is open. */
    const openRepo = project
      .use(Effect.map(RepoPaths, (paths) => paths.root))
      .pipe(Effect.orElseSucceed(() => null));

    /**
     * Every ref of the namespace, whichever repository it was taken in. One whose note does not
     * read, or names another, is simply not offered.
     */
    const every = Effect.gen(function* () {
      const out: DesignRef<N>[] = [];
      for (const ref of yield* store.named(namespace)) {
        const note = yield* Effect.option(decodeNote(ref.note));
        if (note._tag === "Some" && idOf(note.value) === ref.name) {
          out.push({ ...note.value, tree: ref.id });
        }
      }
      return out;
    });

    /**
     * The refs of the open repository, and those that say nothing of where they were taken. The
     * state directory can serve several repositories, one after the other.
     */
    const ofOpenRepo = Effect.gen(function* () {
      const repo = yield* openRepo;
      return (yield* every).filter(
        (ref) => ref.repo === undefined || ref.repo === repo
      );
    });

    /** Newest first; of two kept in one millisecond, the one kept later (`newestFirst`). */
    const byTime = newestFirst<I>(
      (item) => item.at,
      (item) => item.id
    );

    /** The open repository's, as the editor lists them: newest first. */
    const list = Effect.map(ofOpenRepo, (refs) =>
      refs.map(listed).sort(byTime)
    );

    const publish = Effect.flatMap(list, options.publish);

    /** Past the number kept, the oldest go, whichever repository they were taken in. */
    const keepLast = Effect.gen(function* () {
      if (options.keepLast === undefined) {
        return;
      }
      const oldest = (yield* every)
        // Oldest first: the order of the list, turned round.
        .sort((a, b) => byTime(listed(b), listed(a)))
        .slice(0, -options.keepLast);
      if (oldest.length > 0) {
        yield* store.release(namespace, oldest.map(idOf));
      }
    });

    const find = Effect.fnUntraced(function* (id: string) {
      const found = (yield* ofOpenRepo).find((ref) => idOf(ref) === id);
      if (!found) {
        return yield* new NotFound({ message: `unknown ${what}` });
      }
      return found;
    });

    /** The note, with the open repository it is taken in. */
    const located = (note: N) =>
      Effect.map(
        openRepo,
        (repo): N => (repo === null ? note : { ...note, repo })
      );

    /** Keeps `files` under the note's id. A store that cannot be written is a defect. */
    const keep = Effect.fnUntraced(function* (note: N, files: Contents) {
      const noted = yield* encodeNote(yield* located(note)).pipe(Effect.orDie);
      yield* store
        .recordContents(namespace, files, { name: idOf(note), note: noted })
        .pipe(Effect.orDie);
      yield* keepLast;
      yield* publish;
    });

    const gone = (error: { readonly message: string }) =>
      new NotFound({
        message: `The ${what}'s files are no longer kept: ${error.message}`,
      });

    /** Keeps the files of the store's snapshot `tree` under the note's id: no copy, a name. */
    const nameTree = Effect.fnUntraced(function* (note: N, tree: string) {
      const noted = yield* encodeNote(yield* located(note)).pipe(Effect.orDie);
      yield* store
        .name(namespace, tree, { name: idOf(note), note: noted })
        .pipe(
          Effect.catchTags({
            SnapshotMissing: (error) => Effect.fail(gone(error)),
            SnapshotStoreFailed: Effect.die,
          })
        );
      yield* keepLast;
      yield* publish;
    });

    /** Lets go of the refs; the store removes the files only they kept in time. */
    const release = Effect.fnUntraced(function* (ids: Iterable<string>) {
      yield* store.release(namespace, ids);
      yield* publish;
    });

    /** The text of `files` as the ref kept them; all of them when none are named. */
    const textsOf = Effect.fnUntraced(function* (
      ref: DesignRef<N>,
      files?: readonly string[]
    ) {
      const manifest = yield* store.read(ref.tree);
      const wanted = files ?? Object.keys(manifest.files);
      const decoder = new TextDecoder();
      const texts: { [file: string]: string } = {};
      for (const file of wanted) {
        const hash = manifest.files[file];
        if (hash !== undefined) {
          texts[file] = decoder.decode(yield* store.readFile(hash));
        }
      }
      return texts;
    }, Effect.mapError(gone));

    /** What changed from the ref to the design files now, and those files. */
    const changesSince = Effect.fnUntraced(function* (ref: DesignRef<N>) {
      const current = yield* designFiles;
      const changes = yield* store
        .changedFrom(ref.tree, current)
        .pipe(Effect.mapError(gone));
      const before = yield* textsOf(
        ref,
        changes.filter((c) => c.status !== "A").map((c) => c.path)
      );
      return { before, changes, current };
    });

    /** One diff per design file that is not as the ref kept it. */
    const diff = Effect.fnUntraced(function* (ref: DesignRef<N>) {
      const { before, changes, current } = yield* changesSince(ref);
      return changes.map(
        (change): FileDiff => ({
          diff: simpleDiff(
            change.path,
            before[change.path] ?? "",
            current[change.path] ?? ""
          ),
          path: change.path,
        })
      );
    });

    /**
     * Everything back as the ref kept it, through the undo journal: one step the user can take
     * back, each file written or removed told to the editor. A file made since is removed.
     */
    const putBack = Effect.fnUntraced(function* (
      ref: DesignRef<N>,
      label: string
    ) {
      const { before, changes } = yield* changesSince(ref);
      yield* project.use(
        Effect.flatMap(EditService, (edit) =>
          edit.transaction(label, (tx) =>
            Effect.forEach(
              changes,
              (change) =>
                change.status === "A"
                  ? tx.remove(change.path)
                  : tx.write(change.path, before[change.path] ?? ""),
              { discard: true }
            )
          )
        )
      );
    });

    /**
     * Moves what was kept in an older format, one JSON file each under `<state>/<dir>`, into
     * the store with its ids and notes, without the comments, and removes each file once it is
     * in. One that cannot be moved stays where it is and says why in the log; the next start
     * tries it again.
     */
    const importOld = Effect.fnUntraced(
      function* (
        dir: string,
        decodeOld: (text: string) => Effect.Effect<
          {
            readonly files: { readonly [file: string]: string };
            readonly note: N;
          },
          Schema.SchemaError
        >
      ) {
        const from = path.join(yield* storage.stateDir, dir);
        if (!(yield* Effect.orElseSucceed(fs.exists(from), () => false))) {
          return;
        }
        for (const entry of yield* fs.readDirectory(from)) {
          if (!entry.endsWith(".json")) {
            continue;
          }
          const file = path.join(from, entry);
          yield* fs.readFileString(file).pipe(
            Effect.flatMap(decodeOld),
            Effect.flatMap(({ files, note }) =>
              Effect.flatMap(encodeNote(note), (noted) =>
                store.recordContents(
                  namespace,
                  Object.fromEntries(
                    Object.entries(files).filter(([kept]) => keepsFile(kept))
                  ),
                  { name: idOf(note), note: noted }
                )
              )
            ),
            Effect.andThen(fs.remove(file)),
            Effect.catchTag(
              ["PlatformError", "SchemaError", "SnapshotStoreFailed"],
              (error) =>
                Effect.logWarning(
                  `The ${what} ${file} stays in the old format, not moved into the snapshot store: ${error.message}`
                )
            )
          );
        }
        if ((yield* fs.readDirectory(from)).length === 0) {
          // An empty directory left behind holds nothing; the next start finds it empty again.
          yield* Effect.ignore(fs.remove(from, { recursive: true }));
        }
      },
      Effect.catchTag("PlatformError", (error) =>
        Effect.logWarning(
          `The ${what}s kept in the old format were not looked for: ${error.message}`
        )
      )
    );

    return {
      designFiles,
      diff,
      find,
      importOld,
      keep,
      list,
      name: nameTree,
      putBack,
      release,
      textsOf,
    };
  });
