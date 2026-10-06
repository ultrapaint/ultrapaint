import {
  type ApplyInput,
  type ApplyResult,
  DesignNode,
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
import { type EditFailure, EditService } from "./edit.ts";
import { PagesService, parseCanvas } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";

const decodePage = Schema.decodeUnknownEffect(PageDocument);
const decodeNodes = Schema.decodeUnknownEffect(Schema.Array(DesignNode));

/** What a document's text holds, with whether ids had to be filled in, or what is wrong with it. */
export const parseDocument = (
  text: string,
  canvas: boolean
): Effect.Effect<
  | { readonly filled: boolean; readonly root: DesignNode }
  | { readonly problem: string }
> =>
  canvas
    ? parseCanvas(text).pipe(
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

/** What a document is on disk: its text, and the tree it holds when it holds one. */
interface Loaded {
  readonly hash: string;
  readonly problem?: string | undefined;
  readonly root: DesignNode | null;
  readonly text: string | null;
}

const problemOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The design documents of the open project: every page (`<route>.page.json`) and every canvas's
 * canvas (the nodes of `canvas.json`). Reads them, applies operations to them as one undo step
 * per request, and tells the editor whenever one changes — from an edit, an undo, an agent or a
 * checkout. A file that cannot be read as a document is reported, never overwritten.
 */
export class DocumentService extends Context.Service<
  DocumentService,
  {
    readonly apply: (
      input: ApplyInput
    ) => Effect.Effect<ApplyResult, EditFailure | Conflict>;
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
        if (!isPageFile(doc)) {
          return yield* new BadRequest({
            message: `${doc} is not a page or a canvas`,
          });
        }
        return paths.relative(yield* paths.resolve(path.join(root, doc)));
      });

      /** What a document's text is as a document, or why it is not one. */
      const loadedFrom = Effect.fnUntraced(function* (
        text: string,
        canvas: boolean
      ) {
        const hash = hashContent(text);
        const parsed = yield* parseDocument(text, canvas);
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
        Effect.flatMap(parseDocument(text, canvas), (parsed) => {
          if ("problem" in parsed || !parsed.filled) {
            return Effect.succeed(null);
          }
          if (!canvas) {
            return Effect.succeed(
              serialiseDocument({
                root: parsed.root,
                version: DOCUMENT_VERSION,
              })
            );
          }
          // The canvas's layout is kept as it is; only its nodes get their ids.
          return Effect.try(
            () => JSON.parse(text) as Record<string, unknown>
          ).pipe(
            Effect.map((layout): string | null =>
              serialiseDocument({ ...layout, nodes: childrenOf(parsed.root) })
            ),
            Effect.orElseSucceed(() => null)
          );
        });

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

      const list = Effect.fn("DocumentService.list")(function* (
        canvas: string
      ) {
        const { pages: all } = yield* pages.list;
        const docs = [
          ...all.filter((p) => p.canvas === canvas).map((p) => p.id),
          canvasDocOf(canvas),
        ];
        return yield* Effect.forEach(
          docs,
          (doc) => Effect.map(load(doc), (loaded) => stateOf(doc, loaded)),
          { concurrency: 8 }
        );
      });

      /** Every published state, so an event is sent once per change whoever caused it. */
      const published = new Map<string, string>();
      const publish = (state: DocumentState) =>
        Effect.suspend(() => {
          if (published.get(state.doc) === state.hash) {
            return Effect.void;
          }
          published.set(state.doc, state.hash);
          return events.publish("document", state);
        });

      const apply = Effect.fn("DocumentService.apply")(function* (
        input: ApplyInput
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
        yield* edit.transaction(label, (tx) =>
          Effect.forEach(
            input.edits,
            Effect.fnUntraced(function* (change) {
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
              const invalid = (error: { message: string }) =>
                new BadRequest({
                  message: `the result is not a valid document: ${error.message}`,
                });
              if (canvas === null) {
                const document = yield* decodePage({
                  root: result.root,
                  version: DOCUMENT_VERSION,
                }).pipe(Effect.mapError(invalid));
                yield* tx.write(
                  yield* fileOf(change.doc),
                  serialiseDocument(document)
                );
              } else {
                const nodes = yield* decodeNodes(childrenOf(result.root)).pipe(
                  Effect.mapError(invalid)
                );
                yield* pages.updateCanvas(tx, canvas, (layout) => ({
                  ...layout,
                  nodes,
                }));
              }
              created.push(...result.created);
              touched.push(change.doc);
            })
          )
        );
        const documents = yield* Effect.forEach(touched, (doc) =>
          Effect.map(load(doc), (loaded) => stateOf(doc, loaded))
        );
        yield* Effect.forEach(documents, publish, { discard: true });
        return { created, documents } satisfies ApplyResult;
      });

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
            yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));
            yield* Effect.orDie(
              fs.writeFile(path.join(dir, name), new Uint8Array(bytes))
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
        apply,
        get,
        list,
        upload,
      });
    })
  );
}
