import type { FrameSize } from "@ultrapaint/contracts/canvas-layout";
import type { PageDocument } from "@ultrapaint/contracts/document";
import type { Conflict, NotFound } from "@ultrapaint/contracts/errors";
import type {
  Canvas,
  CanvasLayout,
  FrameLayout,
  Page,
  PageList,
} from "@ultrapaint/contracts/pages";
import { Context, Effect, Layer } from "effect";
import { CommentsService } from "./comments.ts";
import type { EditFailure, EditTransaction } from "./edit.ts";
import { makeCanvasOperations } from "./pages-canvases.ts";
import { makePageOperations } from "./pages-operations.ts";
import { makePagesReading } from "./pages-reading.ts";
import { watchDesigns } from "./pages-watcher.ts";

type PagesFailure = EditFailure;

/** Where pages copied into another canvas go: a canvas there is, or a new one of that name. */
export type CopyTarget =
  | { readonly canvas: string }
  | { readonly name: string };

/** What a new page is called, and the URL it serves if any. */
export interface NewPage {
  readonly name: string;
  readonly route?: string | undefined;
}

/**
 * The pages of the designs directory, grouped into the canvases that own them. A canvas is a
 * directory with a `canvas.json`; while there is none the designs directory is itself the one
 * canvas. A page is a `<name>.page.json` design document, or `<name>@<variant>.page.json` for a
 * variant of it, and serves the URL its canvas's `routes` give it, if any. Owns `canvas.json`
 * and `canvases.json`, and watches everything for the editor.
 */
export class PagesService extends Context.Service<
  PagesService,
  {
    readonly create: (
      canvas: string,
      page: NewPage,
      templateId?: string
    ) => Effect.Effect<Page, PagesFailure>;
    /** A page from a document made elsewhere, with its frame sized as given. */
    readonly createWith: (
      canvas: string,
      page: NewPage,
      document: PageDocument,
      frame?: { readonly height: number; readonly width: number }
    ) => Effect.Effect<Page, PagesFailure>;
    /** The page drawn again in a state, in the state's file, its frame beside the page's. */
    readonly createState: (
      id: string,
      state: string
    ) => Effect.Effect<Page, PagesFailure>;
    /** The page drawn again for a variant, in the variant's file, its frame under the page's. */
    readonly createVariant: (
      id: string,
      variant: string
    ) => Effect.Effect<Page, PagesFailure>;
    /**
     * Pages copied or moved into another canvas, with the same URLs; a base page takes its
     * variants along. Moved pages take their comments too; copies start without any.
     */
    readonly copyTo: (
      ids: readonly string[],
      target: CopyTarget,
      move: boolean
    ) => Effect.Effect<readonly Page[], PagesFailure>;
    readonly createCanvas: (
      name: string
    ) => Effect.Effect<Canvas, PagesFailure>;
    readonly deleteCanvas: (id: string) => Effect.Effect<void, PagesFailure>;
    readonly duplicateCanvas: (
      id: string,
      name: string
    ) => Effect.Effect<Canvas, PagesFailure>;
    readonly renameCanvas: (
      id: string,
      name: string
    ) => Effect.Effect<Canvas, PagesFailure>;
    readonly reorderCanvases: (
      order: readonly string[]
    ) => Effect.Effect<void, PagesFailure>;
    /**
     * Deletes the pages, with their comments and, for a base page, its variants and states: one
     * undo step. Answers with the pages deleted, the first asked for first.
     */
    readonly delete: (
      ids: readonly string[]
    ) => Effect.Effect<readonly Page[], PagesFailure>;
    readonly duplicate: (id: string) => Effect.Effect<Page, PagesFailure>;
    readonly list: Effect.Effect<PageList>;
    /** The layout of a canvas: its frames and the nodes on it. */
    readonly readCanvas: (
      canvas: string
    ) => Effect.Effect<CanvasLayout, Conflict | NotFound>;
    /** Repo-relative path of a canvas's `canvas.json`. */
    readonly canvasFile: (canvas: string) => Effect.Effect<string, EditFailure>;
    /** Renames the page, which moves its file and its variants', and its comments; its URL stays. */
    readonly rename: (
      id: string,
      name: string
    ) => Effect.Effect<Page, PagesFailure>;
    /**
     * Sizes one page's frame where it is, or where the editor draws it when it has none saved
     * yet (`canvas-layout`'s `sizeFrame`); every other frame, and whatever else the layout
     * holds, stays as it is at that moment. Answers with the frame.
     */
    readonly setFrame: (
      canvas: string,
      pagePath: string,
      size: FrameSize
    ) => Effect.Effect<FrameLayout, PagesFailure>;
    /** The URL the canvas's prototype opens on, which a page of it must serve. */
    readonly setHome: (
      id: string,
      route: string
    ) => Effect.Effect<Canvas, PagesFailure>;
    /** The URL the page serves from now on, or none; a variant's is its base page's. */
    readonly setRoute: (
      id: string,
      route: string | null
    ) => Effect.Effect<Page, PagesFailure>;
    /** Changes the layout inside an action, which the change becomes part of. */
    readonly updateCanvas: (
      tx: EditTransaction,
      canvas: string,
      update: (layout: CanvasLayout) => CanvasLayout
    ) => Effect.Effect<void, PagesFailure | Conflict>;
    /**
     * Saves where the frames are as the editor has them, over the ones saved: one undo step when
     * anything moved. A frame the editor does not mention stays, and one whose page is gone goes.
     */
    readonly writeFrames: (
      canvas: string,
      frames: Record<string, FrameLayout>
    ) => Effect.Effect<void, PagesFailure>;
  }
>()("ultrapaint/server/PagesService") {
  static readonly layer = Layer.effect(
    PagesService,
    Effect.gen(function* () {
      const reading = yield* makePagesReading;
      const comments = yield* CommentsService;
      // Every operation finds what it acts on, picks a file name and rewrites `canvas.json`
      // inside its step, under the journal's lock: two at once run one after the other.
      const { canvasFile, list, readCanvas, updateCanvas } = reading;
      const {
        copyTo,
        createCanvas,
        deleteCanvas,
        duplicateCanvas,
        renameCanvas,
        reorderCanvases,
        setFrame,
        setHome,
        writeFrames,
      } = makeCanvasOperations(reading, comments);
      const {
        create,
        createState,
        createVariant,
        createWith,
        duplicate,
        remove,
        rename,
        setRoute,
      } = makePageOperations(reading, comments);

      yield* watchDesigns(reading);

      return PagesService.of({
        canvasFile,
        copyTo,
        create,
        createCanvas,
        createState,
        createVariant,
        createWith,
        delete: remove,
        deleteCanvas,
        duplicate,
        duplicateCanvas,
        list,
        readCanvas,
        rename,
        renameCanvas,
        reorderCanvases,
        setFrame,
        setHome,
        setRoute,
        updateCanvas,
        writeFrames,
      });
    })
  );
}
