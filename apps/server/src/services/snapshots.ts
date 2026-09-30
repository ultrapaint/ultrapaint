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
  CanvasOrder,
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
import { makeWriteAtomic } from "../atomic-write.ts";
import { hashContent } from "../hash.ts";
import { makeId } from "../ids.ts";
import { ProjectManager } from "../project.ts";
import { COMMENTS_FILE } from "./comments.ts";
import { parseDocument } from "./documents.ts";
import { EditService, type EditTransaction } from "./edit.ts";
import { canvasIdsIn, pageListOf, parseCanvas } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";
import { Checkpoints, makeDesignFiles } from "./threads/checkpoints.ts";
import { simpleDiff } from "./threads/diff.ts";

const Kept = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.String),
  snapshot: Snapshot,
});
type Kept = typeof Kept.Type;
const RecordJson = Schema.fromJsonString(Kept);
const decodeRecord = Schema.decodeUnknownEffect(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);
const decodeOrder = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CanvasOrder)
);

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

/** Writes what a snapshot kept where it differs, and removes what it did not have. */
const putBack = Effect.fnUntraced(function* (
  tx: EditTransaction,
  before: { readonly [file: string]: string },
  current: { readonly [file: string]: string }
) {
  for (const [file, content] of Object.entries(before)) {
    if (current[file] !== content) {
      yield* tx.write(file, content);
    }
  }
  for (const file of Object.keys(current)) {
    if (!(file in before)) {
      yield* tx.remove(file);
    }
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
      const project = yield* ProjectManager;
      const checkpoints = yield* Checkpoints;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const designFiles = Effect.map(
        makeDesignFiles(fs, path, project),
        (files) =>
          Object.fromEntries(
            Object.entries(files).filter(([file]) => kept(file))
          )
      );
      // Asked for on every write: saving an unsaved session moves the state directory.
      const fileOf = (id: string) =>
        Effect.map(storage.stateDir, (state) =>
          path.join(state, "snapshots", `${id}.json`)
        );
      const dir = path.join(yield* storage.stateDir, "snapshots");
      const store = new Map<string, Kept>();

      yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));
      for (const name of yield* Effect.orDie(fs.readDirectory(dir))) {
        if (!name.endsWith(".json")) {
          continue;
        }
        // A snapshot that cannot be read is simply not offered.
        const record = yield* fs
          .readFileString(path.join(dir, name))
          .pipe(Effect.flatMap(decodeRecord), Effect.option);
        if (record._tag === "Some") {
          store.set(record.value.snapshot.id, record.value);
        }
      }

      const find = (id: string) =>
        Effect.suspend(() => {
          const record = store.get(id);
          return record
            ? Effect.succeed(record)
            : Effect.fail(new NotFound({ message: "unknown snapshot" }));
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
        const record: Kept = {
          files,
          snapshot: {
            at: yield* Clock.currentTimeMillis,
            files: Object.keys(files).length,
            id: yield* makeId("sn"),
            name: name.trim() || "Snapshot",
          },
        };
        store.set(record.snapshot.id, record);
        yield* encodeRecord(record).pipe(
          Effect.flatMap((json) =>
            Effect.flatMap(fileOf(record.snapshot.id), (file) =>
              writeAtomic(file, json)
            )
          ),
          Effect.orDie
        );
        return record.snapshot;
      });

      const remove = Effect.fn("Snapshots.delete")(function* (id: string) {
        yield* find(id);
        store.delete(id);
        yield* Effect.ignore(
          Effect.flatMap(fileOf(id), (file) => fs.remove(file, { force: true }))
        );
      });

      const diff = Effect.fn("Snapshots.diff")(function* (id: string) {
        const record = yield* find(id);
        const current = yield* designFiles;
        const out: GitDiff[] = [];
        const all = new Set([
          ...Object.keys(record.files),
          ...Object.keys(current),
        ]);
        for (const file of [...all].sort()) {
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

      /** Everything back as it was, through the undo journal: one step the user can take back. */
      const restore = Effect.fn("Snapshots.restore")(function* (id: string) {
        const record = yield* find(id);
        const current = yield* designFiles;
        yield* project.use(
          Effect.flatMap(EditService, (edit) =>
            edit.transaction(
              `Restore the snapshot ${record.snapshot.name}`,
              (tx) => putBack(tx, record.files, current)
            )
          )
        );
      });

      /** The snapshot as the editor shows the designs, read off the files it kept. */
      const view = Effect.fn("Snapshots.view")(function* (id: string) {
        const record = yield* find(id);
        const paths = yield* project.use(RepoPaths);
        const designs = paths.relative(paths.designsDir);
        const prefix = designs === "" ? "" : `${designs}/`;
        const files = underDesigns(record.files, prefix);
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
          snapshot: record.snapshot,
        } satisfies SnapshotView;
      });

      return Snapshots.of({
        create,
        delete: remove,
        diff,
        list: Effect.sync(() =>
          Array.from(store.values(), (r) => r.snapshot).sort(
            (a, b) => b.at - a.at
          )
        ),
        restore,
        view,
      });
    })
  );
}
