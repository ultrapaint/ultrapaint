import type { DocumentState } from "@ultrapaint/contracts/document";
import type { NotConfigured, NotFound } from "@ultrapaint/contracts/errors";
import {
  type CanvasLayout,
  emptyCanvasLayout,
  type Page,
} from "@ultrapaint/contracts/pages";
import type { FileDiff } from "@ultrapaint/contracts/snapshots";
import { Snapshot, type SnapshotView } from "@ultrapaint/contracts/snapshots";
import { canvasDocOf, canvasRoot } from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, CANVASES_FILE } from "@ultrapaint/shared/canvas";
import { basename, humanise } from "@ultrapaint/shared/path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { EventBus } from "../events.ts";
import { hashContent } from "../hash.ts";
import { makeId } from "../ids.ts";
import { OpenProject } from "../project.ts";
import { parseCanvasText } from "./canvas-files.ts";
import { makeDesignRefs } from "./design-refs.ts";
import { parseDocument } from "./document-file.ts";
import type { EditFailure } from "./edit.ts";
import { canvasIdsIn, decodeOrder, pageListOf } from "./pages-layout.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Checkpoints } from "./threads/checkpoints.ts";

/** The snapshot store's namespace for the named snapshots of the designs. */
const NAMESPACE = "designs";

/**
 * What the store's ref of a snapshot notes beside the files: the snapshot as it is listed, and
 * the repository it was taken in.
 */
const Note = Schema.Struct({
  repo: Schema.optional(Schema.String),
  snapshot: Snapshot,
});
type Note = typeof Note.Type;

type RestoreFailure = NotFound | NotConfigured | EditFailure;

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
        : yield* parseCanvasText(text).pipe(
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
    const parsed = yield* parseDocument(text);
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
 * is a ref named by its id whose note is its name, date and repository, written as a
 * checkpoint's is (`design-refs`). Keeping a checkpoint names its files again rather than
 * copying them. The editor is told the list whenever one is saved or deleted (`snapshots`),
 * from whichever tab. What is here is the designs' view of one: its pages, canvases and
 * documents.
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
    ) => Effect.Effect<FileDiff[], NotFound | NotConfigured>;
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
      const project = yield* OpenProject;
      const checkpoints = yield* Checkpoints;
      const events = yield* EventBus;
      const refs = yield* makeDesignRefs({
        idOf: (note: Note) => note.snapshot.id,
        listed: (note) => note.snapshot,
        namespace: NAMESPACE,
        note: Schema.fromJsonString(Note),
        publish: (list) => events.publish("snapshots", list),
        what: "snapshot",
      });

      const snapshotOf = Effect.fnUntraced(function* (
        name: string,
        files: number
      ) {
        return {
          at: yield* Clock.currentTimeMillis,
          files,
          id: yield* makeId("sn"),
          name: name.trim() || "Snapshot",
        } satisfies Snapshot;
      });

      /** The designs as they are now, or the files a checkpoint kept under a name of their own. */
      const create = Effect.fn("Snapshots.create")(function* (
        name: string,
        checkpoint?: string
      ) {
        if (checkpoint !== undefined) {
          const kept = yield* checkpoints.find(checkpoint);
          const snapshot = yield* snapshotOf(
            name,
            kept.checkpoint.files.length
          );
          yield* refs.name({ snapshot }, kept.tree);
          return snapshot;
        }
        const files = yield* refs.designFiles;
        const snapshot = yield* snapshotOf(name, Object.keys(files).length);
        yield* refs.keep({ snapshot }, files);
        return snapshot;
      });

      const remove = Effect.fn("Snapshots.delete")(function* (id: string) {
        yield* refs.find(id);
        yield* refs.release([id]);
      });

      const diff = Effect.fn("Snapshots.diff")(function* (id: string) {
        return yield* refs.diff(yield* refs.find(id));
      });

      /** Everything back as it was, through the undo journal: one step the user can take back. */
      const restore = Effect.fn("Snapshots.restore")(function* (id: string) {
        const snapshot = yield* refs.find(id);
        yield* refs.putBack(
          snapshot,
          `Restore the snapshot ${snapshot.snapshot.name}`
        );
      });

      /** The snapshot as the editor shows the designs, read off the files it kept. */
      const view = Effect.fn("Snapshots.view")(function* (id: string) {
        const snapshot = yield* refs.find(id);
        const paths = yield* project.use(RepoPaths);
        const designs = paths.relative(paths.designsDir);
        const prefix = designs === "" ? "" : `${designs}/`;
        const files = underDesigns(yield* refs.textsOf(snapshot), prefix);
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
        list: refs.list,
        restore,
        view,
      });
    })
  );
}
