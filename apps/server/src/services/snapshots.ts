import type { DocumentState } from "@ultrapaint/contracts/document";
import {
  type BadRequest,
  type Conflict,
  type ForbiddenPath,
  type NotConfigured,
  NotFound,
  type Stale,
} from "@ultrapaint/contracts/errors";
import type { GitDiff } from "@ultrapaint/contracts/git";
import {
  type CanvasLayout,
  emptyCanvasLayout,
  type Page,
} from "@ultrapaint/contracts/pages";
import { Snapshot, type SnapshotView } from "@ultrapaint/contracts/snapshots";
import { canvasDocOf, canvasRoot } from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, CANVASES_FILE } from "@ultrapaint/shared/canvas";
import { basename, humanise } from "@ultrapaint/shared/path";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import { hashContent } from "../hash.ts";
import { makeId } from "../ids.ts";
import { ProjectManager } from "../project.ts";
import { COMMENTS_FILE } from "./comments.ts";
import { parseDocument } from "./documents.ts";
import { EditService, type EditTransaction } from "./edit.ts";
import {
  canvasIdsIn,
  decodeOrder,
  pageListOf,
  parseCanvas,
} from "./pages-layout.ts";
import { RepoPaths } from "./repo-paths.ts";
import { SnapshotStore, type TreeChange } from "./snapshot-store.ts";
import { Storage } from "./storage.ts";
import { Checkpoints, makeDesignFiles } from "./threads/checkpoints.ts";
import { simpleDiff } from "./threads/diff.ts";

/** The snapshot store's namespace for the named snapshots of the designs. */
const NAMESPACE = "designs";

/**
 * What the store's ref of a snapshot notes beside the files: the snapshot as it is listed, and
 * the repository it was taken in. The state directory can serve several, one after the other;
 * a snapshot is only seen, and put back, in its own. Absent in one kept before it was recorded.
 */
const Note = Schema.Struct({
  repo: Schema.optional(Schema.String),
  snapshot: Snapshot,
});
type Note = typeof Note.Type;
const NoteJson = Schema.fromJsonString(Note);
const decodeNote = Schema.decodeUnknownEffect(NoteJson);
const encodeNote = Schema.encodeEffect(NoteJson);

/**
 * A snapshot as it was kept before the snapshot store: one JSON file per snapshot under
 * `<state>/snapshots`, with every design file's text. Read once, to move it into the store.
 */
const OldRecordJson = Schema.fromJsonString(
  Schema.Struct({
    files: Schema.Record(Schema.String, Schema.String),
    repo: Schema.optional(Schema.String),
    snapshot: Snapshot,
  })
);
const decodeOldRecord = Schema.decodeUnknownEffect(OldRecordJson);

/** A named snapshot: its note, and the store's snapshot of its files. */
interface Kept extends Note {
  readonly tree: string;
}

type RestoreFailure =
  | NotFound
  | NotConfigured
  | ForbiddenPath
  | Stale
  | Conflict
  | BadRequest;

/**
 * Comments are the conversation about the designs, not the designs: a snapshot neither keeps
 * them nor puts old ones back.
 */
const kept = (file: string) => basename(file) !== COMMENTS_FILE;

/**
 * Writes what a snapshot kept where the files differ from it, and removes what it did not
 * have: `changes` go from the snapshot to now, `before` has the snapshot's text of each file
 * changed or removed since.
 */
const putBack = Effect.fnUntraced(function* (
  tx: EditTransaction,
  changes: readonly TreeChange[],
  before: { readonly [file: string]: string }
) {
  for (const change of changes) {
    yield* change.status === "A"
      ? tx.remove(change.path)
      : tx.write(change.path, before[change.path] ?? "");
  }
});

/** Designs-relative path to content, of the files a snapshot kept under the designs directory. */
const underDesigns = (
  files: { readonly [file: string]: string },
  prefix: string
): { [rel: string]: string } =>
  Object.fromEntries(
    Object.entries(files).flatMap(([file, content]) =>
      file.startsWith(prefix)
        ? [[file.slice(prefix.length), content] as const]
        : []
    )
  );

/** Each canvas's layout, from its canvas.json; one that cannot be read is empty. */
const layoutsOf = Effect.fnUntraced(function* (files: {
  readonly [rel: string]: string;
}) {
  const layouts: { [canvas: string]: CanvasLayout } = {};
  for (const canvas of canvasIdsIn(Object.keys(files))) {
    const text =
      files[canvas === "" ? CANVAS_FILE : `${canvas}/${CANVAS_FILE}`];
    layouts[canvas] =
      text === undefined
        ? emptyCanvasLayout()
        : yield* parseCanvas(text).pipe(
            Effect.map(({ layout }): CanvasLayout => layout),
            Effect.orElseSucceed(() => emptyCanvasLayout())
          );
  }
  return layouts;
});

const orderOf = (files: { readonly [rel: string]: string }) => {
  const text = files[CANVASES_FILE];
  return text === undefined
    ? Effect.succeed([] as readonly string[])
    : decodeOrder(text).pipe(
        Effect.map((o) => o.order),
        Effect.orElseSucceed((): readonly string[] => [])
      );
};

/** Every page's document and every canvas's loose nodes, as the editor holds them. */
const documentsOf = Effect.fnUntraced(function* (
  files: { readonly [rel: string]: string },
  pages: readonly Page[],
  layouts: { readonly [canvas: string]: CanvasLayout }
) {
  const documents: DocumentState[] = [];
  for (const page of pages) {
    const text = files[page.id] ?? "";
    const parsed = yield* parseDocument(text, false);
    documents.push({
      doc: page.id,
      hash: hashContent(text),
      ...("problem" in parsed
        ? { problem: parsed.problem, root: null }
        : { root: parsed.root }),
    });
  }
  for (const [canvas, layout] of Object.entries(layouts)) {
    documents.push({
      doc: canvasDocOf(canvas),
      hash: "",
      root: canvasRoot(layout.nodes ?? []),
    });
  }
  return documents;
});

/**
 * Named points in the history of the designs (ADR 0019): the text of every design file as it
 * was, kept in the state directory until deleted, to look at again or to go back to. A snapshot
 * is not a copy in the repository; git keeps what is committed, and this what is not yet.
 *
 * The files are kept in the tool's snapshot store, under the `designs` namespace: each snapshot
 * is a ref named by its id whose note is its name, date and repository. What is here is the
 * designs' view of one: its pages, canvases and documents, its diff with now, and putting it
 * back through the undo journal.
 */
export class Snapshots extends Context.Service<
  Snapshots,
  {
    readonly create: (
      name: string,
      checkpoint?: string
    ) => Effect.Effect<Snapshot, NotFound | NotConfigured>;
    readonly delete: (id: string) => Effect.Effect<void, NotFound>;
    readonly diff: (
      id: string
    ) => Effect.Effect<GitDiff[], NotFound | NotConfigured>;
    readonly list: Effect.Effect<Snapshot[]>;
    readonly restore: (id: string) => Effect.Effect<void, RestoreFailure>;
    readonly view: (
      id: string
    ) => Effect.Effect<SnapshotView, NotFound | NotConfigured>;
  }
>()("ultrapaint/server/Snapshots") {
  static readonly layer = Layer.effect(
    Snapshots,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const store = yield* SnapshotStore;
      const project = yield* ProjectManager;
      const checkpoints = yield* Checkpoints;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const designFiles = Effect.map(
        makeDesignFiles(fs, path, project),
        (files) =>
          Object.fromEntries(
            Object.entries(files).filter(([file]) => kept(file))
          )
      );

      /**
       * Moves the snapshots kept in the old format into the store, with their ids, names and
       * dates, and removes each file once its snapshot is in. One that cannot be moved stays
       * where it is, and says why in the log; the next start tries it again.
       */
      const importOld = Effect.gen(function* () {
        const dir = path.join(yield* storage.stateDir, "snapshots");
        if (!(yield* Effect.orElseSucceed(fs.exists(dir), () => false))) {
          return;
        }
        const names = yield* fs.readDirectory(dir);
        for (const name of names.filter((n) => n.endsWith(".json"))) {
          const file = path.join(dir, name);
          yield* fs.readFileString(file).pipe(
            Effect.flatMap(decodeOldRecord),
            Effect.flatMap(({ files, repo, snapshot }) =>
              Effect.flatMap(
                encodeNote({ ...(repo !== undefined && { repo }), snapshot }),
                (note) =>
                  store.recordContents(NAMESPACE, files, {
                    name: snapshot.id,
                    note,
                  })
              )
            ),
            Effect.andThen(fs.remove(file)),
            Effect.catchTag(
              ["PlatformError", "SchemaError", "SnapshotStoreFailed"],
              (error) =>
                Effect.logWarning(
                  `The snapshot ${file} stays in the old format, not moved into the snapshot store: ${error.message}`
                )
            )
          );
        }
        if ((yield* fs.readDirectory(dir)).length === 0) {
          // An empty directory left behind holds nothing; the next start finds it empty again.
          yield* Effect.ignore(fs.remove(dir, { recursive: true }));
        }
      }).pipe(
        Effect.catchTag("PlatformError", (error) =>
          Effect.logWarning(
            `The snapshots kept in the old format were not looked for: ${error.message}`
          )
        )
      );
      yield* importOld;

      /** The open repository's root; null when none is open. */
      const openRepo = project
        .use(Effect.map(RepoPaths, (paths) => paths.root))
        .pipe(Effect.orElseSucceed(() => null));

      /** Whether a snapshot belongs to the open repository, or says nothing of where it was taken. */
      const ours = (snapshot: Kept, repo: string | null) =>
        snapshot.repo === undefined || snapshot.repo === repo;

      /** Every snapshot of the open repository. */
      const all = Effect.gen(function* () {
        const repo = yield* openRepo;
        const out: Kept[] = [];
        for (const ref of yield* store.named(NAMESPACE)) {
          // A snapshot whose note cannot be read is simply not offered.
          const note = yield* Effect.option(decodeNote(ref.note));
          if (note._tag === "Some" && note.value.snapshot.id === ref.name) {
            const snapshot: Kept = { ...note.value, tree: ref.id };
            if (ours(snapshot, repo)) {
              out.push(snapshot);
            }
          }
        }
        return out;
      });

      const find = Effect.fnUntraced(function* (id: string) {
        const found = (yield* all).find((s) => s.snapshot.id === id);
        if (!found) {
          return yield* new NotFound({ message: "unknown snapshot" });
        }
        return found;
      });

      const gone = (error: { readonly message: string }) =>
        new NotFound({
          message: `The snapshot's files are no longer kept: ${error.message}`,
        });

      /** The text of `files` as the snapshot kept them; all of them when none are named. */
      const textsOf = Effect.fnUntraced(function* (
        snapshot: Kept,
        files?: readonly string[]
      ) {
        const manifest = yield* store.read(snapshot.tree);
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

      /** What changed from the snapshot to the design files now, and those files. */
      const changesSince = Effect.fnUntraced(function* (snapshot: Kept) {
        const current = yield* designFiles;
        const changes = yield* store
          .changedFrom(snapshot.tree, current)
          .pipe(Effect.mapError(gone));
        const before = yield* textsOf(
          snapshot,
          changes.filter((c) => c.status !== "A").map((c) => c.path)
        );
        return { before, changes, current };
      });

      const create = Effect.fn("Snapshots.create")(function* (
        name: string,
        checkpoint?: string
      ) {
        const files =
          checkpoint === undefined
            ? yield* designFiles
            : Object.fromEntries(
                Object.entries(yield* checkpoints.files(checkpoint)).filter(
                  ([file]) => kept(file)
                )
              );
        const repo = yield* openRepo;
        const snapshot: Snapshot = {
          at: yield* Clock.currentTimeMillis,
          files: Object.keys(files).length,
          id: yield* makeId("sn"),
          name: name.trim() || "Snapshot",
        };
        yield* encodeNote({ ...(repo !== null && { repo }), snapshot }).pipe(
          Effect.flatMap((note) =>
            store.recordContents(NAMESPACE, files, {
              name: snapshot.id,
              note,
            })
          ),
          Effect.orDie
        );
        return snapshot;
      });

      const remove = Effect.fn("Snapshots.delete")(function* (id: string) {
        yield* find(id);
        yield* store.release(NAMESPACE, [id]);
        yield* store.collect;
      });

      const diff = Effect.fn("Snapshots.diff")(function* (id: string) {
        const { before, changes, current } = yield* changesSince(
          yield* find(id)
        );
        return changes.map(
          (change): GitDiff => ({
            diff: simpleDiff(
              change.path,
              before[change.path] ?? "",
              current[change.path] ?? ""
            ),
            path: change.path,
          })
        );
      });

      /** Everything back as it was, through the undo journal: one step the user can take back. */
      const restore = Effect.fn("Snapshots.restore")(function* (id: string) {
        const snapshot = yield* find(id);
        const { before, changes } = yield* changesSince(snapshot);
        yield* project.use(
          Effect.flatMap(EditService, (edit) =>
            edit.transaction(
              `Restore the snapshot ${snapshot.snapshot.name}`,
              (tx) => putBack(tx, changes, before)
            )
          )
        );
      });

      /** The snapshot as the editor shows the designs, read off the files it kept. */
      const view = Effect.fn("Snapshots.view")(function* (id: string) {
        const snapshot = yield* find(id);
        const paths = yield* project.use(RepoPaths);
        const designs = paths.relative(paths.designsDir);
        const prefix = designs === "" ? "" : `${designs}/`;
        const files = underDesigns(yield* textsOf(snapshot), prefix);
        const layouts = yield* layoutsOf(files);
        const list = pageListOf({
          fileOf: (rel) => `${prefix}${rel}`,
          files: Object.keys(files),
          layouts,
          order: yield* orderOf(files),
          rootName: humanise(basename(paths.designsDir)),
        });
        return {
          canvases: list.canvases,
          documents: yield* documentsOf(files, list.pages, layouts),
          layouts,
          pages: list.pages,
          snapshot: snapshot.snapshot,
        } satisfies SnapshotView;
      });

      return Snapshots.of({
        create,
        delete: remove,
        diff,
        list: Effect.map(all, (snapshots) =>
          snapshots.map((s) => s.snapshot).sort((a, b) => b.at - a.at)
        ),
        restore,
        view,
      });
    })
  );
}
