import {
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
  componentDocOf,
  componentFileOf,
  componentOfDoc,
} from "@ultrapaint/contracts/components";
import {
  type AppliedChanges,
  type ApplyInput,
  DesignNode,
  type DocumentChange,
  type DocumentEdit,
  type DocumentState,
  PageDocument,
} from "@ultrapaint/contracts/document";
import {
  BadRequest,
  Conflict,
  NotFound,
  Stale,
} from "@ultrapaint/contracts/errors";
import {
  ASSETS_DIR,
  type UploadAssetInput,
} from "@ultrapaint/contracts/pages";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { fillIds, makeIdGenerator } from "@ultrapaint/design-document/ids";
import { applyOps, DocumentOpError } from "@ultrapaint/design-document/ops";
import { changedNodes } from "@ultrapaint/design-document/patch";
import {
  canvasDocOf,
  canvasOfDoc,
  canvasRoot,
  childrenOf,
  DOCUMENT_VERSION,
  idsOf,
  isPageFile,
} from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import { slugOf } from "@ultrapaint/shared/path";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { makeExists } from "../fs-exists.ts";
import { hashContent, toPosix } from "../hash.ts";
import { canvasText, readCanvasText } from "./canvas-file.ts";
import {
  componentText,
  readComponentFile,
  withTree,
} from "./component-files.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";

const decodePage = Schema.decodeUnknownEffect(PageDocument);
const decodeNodes = Schema.decodeUnknownEffect(Schema.Array(DesignNode));
const decodeNode = Schema.decodeUnknownEffect(DesignNode);

/** What a document's text holds, with whether ids had to be filled in, or what is wrong with it. */
export const parseDocument = (
  text: string,
  canvas: boolean
): Effect.Effect<
  | { readonly filled: boolean; readonly root: DesignNode }
  | { readonly problem: string }
> =>
  canvas
    ? readCanvasText(text).pipe(
        Effect.map(({ filled, layout }) => ({
          filled,
          root: canvasRoot(layout.nodes ?? []),
        })),
        Effect.catch((error) => Effect.succeed({ problem: error.message }))
      )
    : Effect.try({
        catch: (error) => `not JSON: ${problemOf(error)}`,
        try: () => JSON.parse(text) as unknown,
      }).pipe(
        Effect.flatMap((json) => {
          const filled = fillIds(json);
          return decodePage(json).pipe(
            Effect.map(({ root }) => ({ filled, root })),
            Effect.mapError((error) => error.message)
          );
        }),
        Effect.catch((problem) => Effect.succeed({ problem }))
      );

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** How many documents' trees are kept by their text, so the same text is parsed once. */
const PARSED_KEPT = 64;

/** What a document is on disk: its text, and the tree it holds when it holds one. */
interface Loaded {
  readonly hash: string;
  readonly problem?: string | undefined;
  readonly root: DesignNode | null;
  readonly text: string | null;
}

const problemOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What `apply`'s `alongside` works with: the step's files, and the documents as they are in it. */
export interface ApplyStep {
  /** Every page and canvas of every canvas. */
  readonly all: Effect.Effect<readonly DocumentState[], EditFailure>;
  readonly get: (doc: string) => Effect.Effect<DocumentState, EditFailure>;
  readonly tx: EditTransaction;
}

/** What `alongside` adds to the step: more edits, or nothing but its files. */
type Alongside = readonly DocumentEdit[] | undefined;

/**
 * What applying edits gives: the ids the operations created, each document touched as it is now
 * and as the editors were told it (ADR 0044).
 */
export interface Applied extends AppliedChanges {
  readonly documents: readonly DocumentState[];
}

/**
 * The design documents of the open project: every page (`<route>.page.json`) and every canvas's
 * canvas (the nodes of `canvas.json`). Reads them, applies operations to them as one undo step
 * per request, and tells the editor whenever one changes — from an edit, an undo, an agent or a
 * checkout. A file that cannot be read as a document is reported, never overwritten.
 */
export class DocumentService extends Context.Service<
  DocumentService,
  {
    /**
     * Applies the edits as one undo step; `alongside` changes other files of the designs in the
     * same step (a component's file written as an instance of it takes a node's place), and may
     * give edits of its own, made of the documents as they are under the journal (`step.all`,
     * `step.get`), so no edit made meanwhile fails or is lost. Answers with each document touched
     * and its change as the editors were told it.
     */
    readonly apply: (
      input: ApplyInput,
      alongside?: (step: ApplyStep) => Effect.Effect<Alongside, EditFailure>
    ) => Effect.Effect<Applied, EditFailure | Conflict>;
    /** Every page and canvas of every canvas, as each is saved now. */
    readonly all: Effect.Effect<readonly DocumentState[], EditFailure>;
    readonly get: (
      doc: string
    ) => Effect.Effect<DocumentState, NotFound | EditFailure>;
    readonly list: (
      canvas: string
    ) => Effect.Effect<readonly DocumentState[], EditFailure>;
    /** Saves an image into the shared assets; answers with the path a node shows it by. */
    readonly upload: (
      input: UploadAssetInput
    ) => Effect.Effect<{ readonly src: string }, EditFailure>;
  }
>()("ultrapaint/server/DocumentService") {
  static readonly layer = Layer.effect(
    DocumentService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const pages = yield* PagesService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = paths.designsDir;
      // Two uploads at once would choose the same free name.
      const naming = yield* Semaphore.make(1);

      const exists = makeExists(fs);

      /** The file behind a document, repo-relative. */
      const fileOf = Effect.fnUntraced(function* (doc: string) {
        const canvas = canvasOfDoc(doc);
        if (canvas !== null) {
          return yield* pages.canvasFile(canvas);
        }
        const component = componentOfDoc(doc);
        if (component !== null) {
          return paths.relative(
            yield* paths.resolve(path.join(root, componentFileOf(component)))
          );
        }
        if (!isPageFile(doc)) {
          return yield* new BadRequest({
            message: `${doc} is not a page or a canvas`,
          });
        }
        return paths.relative(yield* paths.resolve(path.join(root, doc)));
      });

      /** An app component's file as the document of its tree (ADR 0041), or why it is not one. */
      const componentLoaded = (text: string): Loaded => {
        const read = readComponentFile(text);
        if ("component" in read && read.component.origin === "app") {
          return { hash: hashContent(text), root: read.component.tree, text };
        }
        return {
          hash: hashContent(text),
          problem: `not an app component: ${"problem" in read ? read.problem : `${read.component.name} is a system component's look`}`,
          root: null,
          text,
        };
      };

      /**
       * The latest documents read, by their text's hash: an edit reads its document before the
       * step, in it, and again to tell the editor, and the text is the same each time but the last,
       * which the step wrote and knows the tree of.
       */
      const parsedByHash = new Map<
        string,
        Effect.Success<ReturnType<typeof parseDocument>>
      >();
      const keepParsed = (
        key: string,
        parsed: Effect.Success<ReturnType<typeof parseDocument>>
      ) => {
        parsedByHash.delete(key);
        parsedByHash.set(key, parsed);
        if (parsedByHash.size > PARSED_KEPT) {
          const [oldest] = parsedByHash.keys();
          if (oldest !== undefined) {
            parsedByHash.delete(oldest);
          }
        }
      };

      /** What a document's text is as a document, or why it is not one. */
      const loadedFrom = Effect.fnUntraced(function* (
        text: string,
        canvas: boolean
      ) {
        const hash = hashContent(text);
        const key = `${canvas ? "canvas" : "page"}:${hash}`;
        const parsed =
          parsedByHash.get(key) ?? (yield* parseDocument(text, canvas));
        keepParsed(key, parsed);
        const loaded: Loaded =
          "problem" in parsed
            ? { hash, problem: parsed.problem, root: null, text }
            : { hash, root: parsed.root, text };
        return { filled: "filled" in parsed && parsed.filled, loaded };
      });

      /**
       * Reads a document. Ids a hand-written file leaves out are filled in and written back,
       * outside the undo history: the file then says what the editor and agents call its nodes.
       * The write goes through the journal, so it is atomic, made one writer at a time, and the
       * steps that recorded the file see it. Inside a transaction, which holds the journal,
       * `persist` is false: the ids are filled in what is read, and the action writes them.
       */
      const load = Effect.fnUntraced(function* (
        doc: string,
        persist = true
      ): Effect.fn.Return<Loaded, EditFailure> {
        const rel = yield* fileOf(doc);
        const abs = yield* paths.resolve(rel);
        const text = yield* fs.readFileString(abs).pipe(
          // A document deleted, or deleted while it was read, is one that is not there.
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null)
          ),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `${rel} cannot be read: ${error.message}`,
              })
          )
        );
        const canvas = canvasOfDoc(doc) !== null;
        if (text !== null && componentOfDoc(doc) !== null) {
          return componentLoaded(text);
        }
        if (text === null) {
          const missing: Loaded = {
            hash: "",
            root: canvas ? canvasRoot([]) : null,
            text,
          };
          return missing;
        }
        const read = yield* loadedFrom(text, canvas);
        if (!(read.filled && persist)) {
          return read.loaded;
        }
        const written = yield* edit
          .amend(rel, (content) =>
            content === null
              ? Effect.fail(new NotFound({ message: `${rel} is gone` }))
              : Effect.map(withIds(content, canvas), (next) => {
                  const kept = next ?? content;
                  return [kept, kept] as const;
                })
          )
          .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
        if (written === null) {
          return read.loaded;
        }
        return (yield* loadedFrom(written, canvas)).loaded;
      });

      /**
       * The text a document should have, with the ids it leaves out filled in; null when none
       * are missing, or it is not a document.
       */
      const withIds = (text: string, canvas: boolean) =>
        canvas
          ? readCanvasText(text).pipe(
              Effect.map(({ filled, layout }) =>
                filled ? canvasText(layout) : null
              ),
              Effect.orElseSucceed(() => null)
            )
          : Effect.map(parseDocument(text, false), (parsed) =>
              "problem" in parsed || !parsed.filled
                ? null
                : serialiseDocument({
                    root: parsed.root,
                    version: DOCUMENT_VERSION,
                  })
            );

      const stateOf = (doc: string, loaded: Loaded): DocumentState => ({
        doc,
        hash: loaded.hash,
        ...(loaded.problem !== undefined && { problem: loaded.problem }),
        root: loaded.root,
      });

      const get = Effect.fn("DocumentService.get")(function* (doc: string) {
        const loaded = yield* load(doc);
        if (loaded.text === null && canvasOfDoc(doc) === null) {
          return yield* new NotFound({ message: `no page ${doc}` });
        }
        return stateOf(doc, loaded);
      });

      /** The documents of a canvas, read and, outside a step (`persist`), their ids written. */
      const listed = Effect.fnUntraced(function* (
        canvas: string,
        persist = true
      ) {
        const { pages: all } = yield* pages.list;
        const docs = [
          ...all.filter((p) => p.canvas === canvas).map((p) => p.id),
          canvasDocOf(canvas),
        ];
        return yield* Effect.forEach(
          docs,
          (doc) =>
            Effect.map(load(doc, persist), (loaded) => stateOf(doc, loaded)),
          { concurrency: 8 }
        );
      });
      const list = Effect.fn("DocumentService.list")(function* (
        canvas: string
      ) {
        return yield* listed(canvas);
      });

      /** Every document of every canvas, read and, outside a step, their ids written. */
      const allOf = (persist: boolean) =>
        Effect.gen(function* () {
          const { canvases } = yield* pages.list;
          return (yield* Effect.forEach(canvases, (c) =>
            listed(c.id, persist)
          )).flat();
        });
      // Inside a step, which holds the journal: nothing is written but by the step.
      const allIn = allOf(false);
      const stateIn = (doc: string) =>
        Effect.map(load(doc, false), (loaded) => stateOf(doc, loaded));

      /**
       * Every published state and the change it was told as, so an event is sent once per change
       * whoever caused it, and says what changed since the state published before.
       */
      const published = new Map<
        string,
        { readonly change: DocumentChange; readonly state: DocumentState }
      >();
      const changeSince = (
        before: DocumentState | undefined,
        state: DocumentState
      ): DocumentChange => {
        if (
          before?.root &&
          state.root &&
          before.problem === undefined &&
          state.problem === undefined
        ) {
          const nodes = changedNodes(before.root, state.root);
          if (nodes) {
            return {
              doc: state.doc,
              from: before.hash,
              hash: state.hash,
              nodes,
              rootId: state.root.id,
            };
          }
        }
        return state;
      };
      /** Tells the editors of a state they were not told yet; answers with it as they were told. */
      const publish = (state: DocumentState) =>
        Effect.suspend((): Effect.Effect<DocumentChange> => {
          const before = published.get(state.doc);
          if (before?.state.hash === state.hash) {
            return Effect.succeed(before.change);
          }
          const change = changeSince(before?.state, state);
          published.set(state.doc, { change, state });
          return Effect.as(events.publish("document", change), change);
        });

      /** A document's edited tree written to its file: a page's, a canvas's, a component's. */
      const writeDocument = Effect.fnUntraced(function* (
        tx: EditTransaction,
        doc: string,
        loaded: Loaded,
        edited: DesignNode
      ) {
        const invalid = (error: { message: string }) =>
          new BadRequest({
            message: `the result is not a valid document: ${error.message}`,
          });
        const canvas = canvasOfDoc(doc);
        if (componentOfDoc(doc) !== null) {
          const tree = yield* decodeNode(edited).pipe(Effect.mapError(invalid));
          const read = readComponentFile(loaded.text ?? "");
          if (!("component" in read && read.component.origin === "app")) {
            return yield* invalid({
              message:
                "problem" in read ? read.problem : "not an app component",
            });
          }
          yield* tx.write(
            yield* fileOf(doc),
            componentText(withTree(read.component, tree))
          );
        } else if (canvas === null) {
          const document = yield* decodePage({
            root: edited,
            version: DOCUMENT_VERSION,
          }).pipe(Effect.mapError(invalid));
          const text = serialiseDocument(document);
          keepParsed(`page:${hashContent(text)}`, {
            filled: false,
            root: document.root,
          });
          yield* tx.write(yield* fileOf(doc), text);
        } else {
          const nodes = yield* decodeNodes(childrenOf(edited)).pipe(
            Effect.mapError(invalid)
          );
          yield* pages.updateCanvas(tx, canvas, (layout) => ({
            ...layout,
            nodes,
          }));
        }
      });

      const apply = Effect.fn("DocumentService.apply")(function* (
        input: ApplyInput,
        alongside?: (step: ApplyStep) => Effect.Effect<Alongside, EditFailure>
      ) {
        const created: string[] = [];
        const touched: string[] = [];
        const label =
          input.label ??
          (input.edits.length === 1 && input.edits[0]?.ops.length === 1
            ? `Edit ${input.edits[0]?.ops[0]?.op ?? "document"}`
            : "Edit the design");
        // Ids a document leaves out are written before the action, which holds the journal.
        yield* Effect.forEach(input.edits, (change) => load(change.doc), {
          discard: true,
        });
        const editIn = (tx: EditTransaction) =>
          Effect.fnUntraced(function* (change: DocumentEdit) {
            const loaded = yield* load(change.doc, false);
            if (loaded.problem !== undefined || loaded.root === null) {
              return yield* new BadRequest({
                message: `${change.doc} cannot be edited: ${loaded.problem ?? "it does not exist"}`,
              });
            }
            if (
              change.expectedHash !== undefined &&
              change.expectedHash !== loaded.hash
            ) {
              return yield* new Stale({
                message: `${change.doc} changed since you last saw it; reloading`,
              });
            }
            const canvas = canvasOfDoc(change.doc);
            const result = yield* Effect.try({
              catch: (error) =>
                new BadRequest({
                  message:
                    error instanceof DocumentOpError
                      ? error.message
                      : `the operations could not be applied: ${problemOf(error)}`,
                }),
              try: () =>
                applyOps(loaded.root as DesignNode, change.ops, {
                  canvas: canvas !== null,
                  next: makeIdGenerator(idsOf(loaded.root as DesignNode)),
                }),
            });
            yield* writeDocument(tx, change.doc, loaded, result.root);
            created.push(...result.created);
            touched.push(change.doc);
          });
        yield* edit.transaction(label, (tx) =>
          Effect.gen(function* () {
            const more = alongside
              ? yield* alongside({ all: allIn, get: stateIn, tx })
              : undefined;
            yield* Effect.forEach(
              [...input.edits, ...(more ?? [])],
              editIn(tx),
              {
                discard: true,
              }
            );
          })
        );
        const documents = yield* Effect.forEach(touched, (doc) =>
          Effect.map(load(doc), (loaded) => stateOf(doc, loaded))
        );
        const changes = yield* Effect.forEach(documents, publish);
        return { changes, created, documents } satisfies Applied;
      });

      const all = allOf(true).pipe(Effect.withSpan("DocumentService.all"));

      const upload = Effect.fn("DocumentService.upload")(function* (
        input: UploadAssetInput
      ) {
        const extension = path.extname(input.name).slice(1).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension)) {
          return yield* new BadRequest({
            message: `${input.name} is not an image the canvas can show`,
          });
        }
        const bytes = Buffer.from(input.data, "base64");
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          return yield* new BadRequest({
            message: `${input.name} is larger than 20 MB`,
          });
        }
        // Into the shared assets, which every canvas can show; a canvas's own are for images
        // it draws differently from the others, and come with it when it is duplicated.
        const dir = yield* paths.resolve(path.join(root, ASSETS_DIR));
        const base = slugOf(
          path.basename(input.name, path.extname(input.name))
        );
        return yield* naming.withPermits(1)(
          Effect.gen(function* () {
            let name = `${base}.${extension}`;
            for (let n = 2; yield* exists(path.join(dir, name)); n += 1) {
              name = `${base}-${n}.${extension}`;
            }
            // Assets stay out of the undo journal, which holds text: an undone image node
            // leaves its file, as a deleted one does.
            yield* Effect.andThen(
              fs.makeDirectory(dir, { recursive: true }),
              fs.writeFile(path.join(dir, name), new Uint8Array(bytes))
            ).pipe(
              Effect.mapError(
                (error) =>
                  new Conflict({
                    message: `${input.name} could not be saved: ${error.message}`,
                  })
              )
            );
            return { src: `${ASSETS_DIR}/${name}` };
          })
        );
      });

      // ---- changes from anywhere ----
      /** The document a changed file is, or null when it is not one. */
      const docOfFile = (file: string): string | null => {
        const abs = path.resolve(paths.root, file);
        const rel = toPosix(path.relative(root, abs));
        if (rel.startsWith("..")) {
          return null;
        }
        if (path.basename(abs) === CANVAS_FILE) {
          const dir = toPosix(path.dirname(rel));
          return canvasDocOf(dir === "." ? ROOT_CANVAS : dir);
        }
        // An app component's tree is a document too: one edited in place follows its file.
        if (
          toPosix(path.dirname(rel)) === COMPONENTS_DIR &&
          rel.endsWith(COMPONENT_EXTENSION)
        ) {
          return componentDocOf(path.basename(rel, COMPONENT_EXTENSION));
        }
        return isPageFile(rel) ? rel : null;
      };

      yield* events.subscribe("file.changed").pipe(
        Stream.mapEffect(({ file }) => {
          const doc = docOfFile(file);
          if (doc === null) {
            return Effect.void;
          }
          // A page that is gone is published with no root: the editor drops it. Whatever goes
          // wrong with one file is logged, and the next change is still heard.
          return load(doc).pipe(
            Effect.flatMap((loaded) => publish(stateOf(doc, loaded))),
            Effect.catchCause((cause) =>
              Effect.logWarning(`${file} changed and could not be read`, cause)
            )
          );
        }),
        Stream.runDrain,
        Effect.forkScoped
      );

      return DocumentService.of({
        all,
        apply,
        get,
        list,
        upload,
      });
    })
  );
}
