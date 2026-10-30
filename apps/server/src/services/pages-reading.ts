/**
 * How the pages service reads the designs directory: the canvases' layouts and their order, the
 * page list and its publishing, and the lookups and checks every page and canvas operation
 * starts from. The operations, in `pages-canvases.ts` and `pages-operations.ts`, and the watcher
 * share one of these, made once by the service's layer.
 */
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  type CanvasLayout,
  type CanvasOrder,
  emptyCanvasLayout,
  type PageList,
} from "@ultrapaint/contracts/pages";
import { serialise } from "@ultrapaint/design-document/factories";
import { isPageFile, PAGE_EXTENSION } from "@ultrapaint/design-document/tree";
import {
  CANVAS_FILE,
  CANVASES_FILE,
  ROOT_CANVAS,
} from "@ultrapaint/shared/canvas";
import { basename, humanise, slugOf } from "@ultrapaint/shared/path";
import {
  normaliseRoute,
  routesOf,
  variantPathOf,
} from "@ultrapaint/shared/route";
import { Effect, FileSystem, Path, Semaphore } from "effect";
import { EventBus } from "../events.ts";
import { makeExists } from "../fs-exists.ts";
import { makeWalk } from "../fs-walk.ts";
import { toPosix } from "../hash.ts";
import { safeCanvasId } from "../ids.ts";
import { canvasCodec, readCanvasText } from "./canvas-file.ts";
import { EditService, type EditTransaction, updateFile } from "./edit.ts";
import {
  canvasIdsIn,
  decodeOrder,
  followHome,
  IGNORED_DIRS,
  pageListOf,
  pageOf,
} from "./pages-layout.ts";
import { RepoPaths } from "./repo-paths.ts";

export const makePagesReading = Effect.gen(function* () {
  const paths = yield* RepoPaths;
  const edit = yield* EditService;
  const events = yield* EventBus;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const walk = makeWalk(fs, path);
  const root = paths.designsDir;

  const exists = makeExists(fs);

  const relativeToDesigns = (abs: string) => toPosix(path.relative(root, abs));

  // ---- canvas layout ----
  const canvasPath = (canvas: string) => path.join(root, canvas, CANVAS_FILE);

  const readCanvas = Effect.fn("PagesService.readCanvas")(function* (
    canvas: string
  ) {
    const file = canvasPath(yield* safeCanvasId(canvas));
    const text = yield* fs.readFileString(file).pipe(
      // A canvas without a canvas.json, or one deleted while it was read, has no layout yet.
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed(null)
      ),
      Effect.mapError(
        (error) =>
          new Conflict({
            message: `${canvas || "the designs root"}'s ${CANVAS_FILE} cannot be read: ${error.message}`,
          })
      )
    );
    if (text === null) {
      return emptyCanvasLayout();
    }
    const { layout } = yield* readCanvasText(text).pipe(
      Effect.mapError(
        (error) =>
          new Conflict({
            message: `${error.message} (in ${canvas || "the designs root"})`,
          })
      )
    );
    return layout;
  });

  const canvasFile = Effect.fnUntraced(function* (canvas: string) {
    return paths.relative(
      yield* paths.resolve(canvasPath(yield* safeCanvasId(canvas)))
    );
  });

  /** Changes the layout inside an action, read as the action has it. */
  const updateCanvas = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string,
    update: (layout: CanvasLayout) => CanvasLayout
  ) {
    yield* updateFile(tx, yield* canvasFile(canvas), canvasCodec, update);
  });

  /**
   * A page's text as the action has it. Read inside the action that writes from it, so an edit
   * to the page cannot land between the reading and the writing and be lost.
   */
  const contentIn = Effect.fnUntraced(function* (
    tx: EditTransaction,
    file: string
  ) {
    const content = yield* tx.read(file);
    if (content === null) {
      return yield* new NotFound({ message: `file not found: ${file}` });
    }
    return content;
  });

  /** A canvas's layout as the action has it. */
  const canvasIn = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string
  ) {
    return yield* tx.readDocument(yield* canvasFile(canvas), canvasCodec).pipe(
      Effect.catchTag("Conflict", (error) =>
        Effect.fail(
          new Conflict({
            message: `${error.message} (in ${canvas || "the designs root"})`,
          })
        )
      )
    );
  });

  /** Rewrites the frames of a canvas; a missing source frame means there is nothing to do. */
  const updateFrames = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string,
    update: (frames: CanvasLayout["frames"]) => CanvasLayout["frames"] | null
  ) {
    yield* updateCanvas(tx, canvas, (layout) => {
      const frames = update(layout.frames);
      return frames ? { ...layout, frames } : layout;
    });
  });

  // ---- the order of the list ----
  const orderPath = path.join(root, CANVASES_FILE);

  const readOrder = Effect.gen(function* () {
    if (!(yield* exists(orderPath))) {
      return [] as readonly string[];
    }
    // A list that cannot be read orders nothing: the canvases are still all there.
    return yield* Effect.orElseSucceed(
      Effect.flatMap(fs.readFileString(orderPath), (text) =>
        Effect.map(decodeOrder(text), (file) => file.order)
      ),
      (): readonly string[] => []
    );
  });

  const writeOrder = (tx: EditTransaction, order: readonly string[]) =>
    tx.write(
      paths.relative(orderPath),
      serialise({ order, version: 1 } satisfies CanvasOrder)
    );

  // ---- canvases and pages ----
  const found = walk(root, {
    includeFile: (name) => name === CANVAS_FILE || isPageFile(name),
    skipDir: (name) =>
      IGNORED_DIRS.has(name) || name.startsWith(".") || name.startsWith("_"),
  });

  const fallbackName = (id: string) =>
    id === ROOT_CANVAS ? humanise(basename(root)) : humanise(id);

  /** The page a file of a canvas is, as the canvas's routes have it now. */
  const toPage = Effect.fnUntraced(function* (
    canvas: string,
    pagePath: string,
    abs: string
  ) {
    const layout = yield* Effect.orElseSucceed(readCanvas(canvas), () =>
      emptyCanvasLayout()
    );
    return pageOf(
      canvas,
      pagePath,
      relativeToDesigns(abs),
      paths.relative(abs),
      layout
    );
  });

  /** The list, and the files under the designs directory it was made from. */
  const scan = Effect.gen(function* () {
    const files = (yield* found).map(relativeToDesigns);
    const ids = canvasIdsIn(files);
    // A canvas.json that cannot be read is reported when it is opened; the list still has it.
    const layouts = yield* Effect.forEach(ids, (id) =>
      Effect.map(
        Effect.orElseSucceed(readCanvas(id), () => emptyCanvasLayout()),
        (layout) => [id, layout] as const
      )
    );
    const pageList = pageListOf({
      fileOf: (rel) => paths.relative(path.join(root, rel)),
      files,
      layouts: Object.fromEntries(layouts),
      order: yield* readOrder,
      rootName: fallbackName(ROOT_CANVAS),
    });
    return { files, pageList };
  }).pipe(Effect.withSpan("PagesService.list"));

  const list: Effect.Effect<PageList> = Effect.map(
    scan,
    ({ pageList }) => pageList
  );

  /**
   * What the editors were last sent: the files it was made from, so the watcher can tell a
   * change that may alter it from one that cannot, and the list itself, so the same list is
   * not sent twice (a page PNG pass, for one, runs on every list that arrives).
   */
  let published: { files: Set<string>; json: string } | null = null;

  // Read and sent one at a time: two actions done at once each send the list they leave, and
  // the editors are left with the later one.
  const publishing = yield* Semaphore.make(1);

  /** The list as it is now, sent to the editors if it is not what they have. */
  const publishList = publishing.withPermits(1)(
    Effect.gen(function* () {
      const { files, pageList } = yield* scan;
      const json = JSON.stringify(pageList);
      const changed = json !== published?.json;
      published = { files: new Set(files), json };
      if (changed) {
        yield* events.publish("pages", pageList);
      }
      return pageList;
    })
  );

  // ---- lifecycle ----
  /** The page of that id, in the list as the action has it. */
  const byId = Effect.fnUntraced(function* (id: string, all: PageList) {
    const page = all.pages.find((p) => p.id === id);
    if (!page) {
      return yield* new NotFound({ message: `page not found: ${id}` });
    }
    const abs = yield* paths.resolve(path.join(root, page.id));
    return { abs, page };
  });

  /** The canvas of that id, in the list as the action has it. */
  const canvasById = Effect.fnUntraced(function* (id: string, all: PageList) {
    const canvas = all.canvases.find((c) => c.id === id);
    if (!canvas) {
      return yield* new NotFound({ message: `canvas not found: ${id}` });
    }
    return canvas;
  });

  const failIfExists = Effect.fnUntraced(function* (abs: string) {
    if (yield* exists(abs)) {
      return yield* new Conflict({
        message: `a page with that name exists already: ${path.basename(abs)}`,
      });
    }
  });

  /**
   * The file a new page of that name goes in, in `dir` inside the canvas: its name made safe,
   * numbered past the files there are. `taken` are paths the same action is about to use.
   */
  const freePagePath = Effect.fnUntraced(function* (
    canvas: string,
    dir: string,
    name: string,
    variant?: string,
    taken: readonly string[] = []
  ) {
    const stem = `${dir === "" ? "" : `${dir}/`}${slugOf(name)}`;
    const fileFor = (count: number) => {
      const file = `${count === 1 ? stem : `${stem}-${count}`}${PAGE_EXTENSION}`;
      return variant === undefined ? file : variantPathOf(file, variant);
    };
    let n = 1;
    while (
      taken.includes(fileFor(n)) ||
      (yield* exists(path.join(root, canvas, fileFor(n))))
    ) {
      n += 1;
    }
    return fileFor(n);
  });

  /**
   * A URL a page may serve in its canvas: written the way routes are, and served by no other
   * page there. `except` is the page taking it, which may have it already.
   */
  const checkRoute = Effect.fnUntraced(function* (
    all: PageList,
    canvas: string,
    route: string,
    except?: string
  ) {
    const trimmed = route.trim();
    if (trimmed === "") {
      return yield* new BadRequest({ message: "a URL cannot be empty" });
    }
    const normalised = normaliseRoute(
      trimmed.startsWith("/") ? trimmed : `/${trimmed}`
    );
    const holder = all.pages.find(
      (p) =>
        p.canvas === canvas &&
        p.variant === undefined &&
        p.path !== except &&
        p.route === normalised
    );
    if (holder) {
      return yield* new Conflict({
        message: `${holder.name} serves ${normalised} already`,
      });
    }
    return normalised;
  });

  /**
   * Changes the canvas's routes inside an action. A canvas that has none yet has them written
   * out first, from its pages' paths, so its other pages keep the URLs they serve. The URL
   * the canvas opens on follows its page to a new one, or falls back to another page's.
   */
  const updateRoutes = (
    tx: EditTransaction,
    all: PageList,
    canvas: string,
    update: (routes: Record<string, string>) => Record<string, string>
  ) =>
    updateCanvas(tx, canvas, (layout) => {
      const before = routesOf(
        layout.routes,
        all.pages
          .filter((p) => p.canvas === canvas && p.variant === undefined)
          .map((p) => p.path)
      );
      const routes = update(before);
      const { home: _, ...rest } = layout;
      const home = followHome(layout.home, before, routes);
      return { ...rest, ...(home !== undefined && { home }), routes };
    });

  return {
    byId,
    canvasById,
    canvasFile,
    canvasIn,
    canvasPath,
    checkRoute,
    contentIn,
    edit,
    events,
    exists,
    failIfExists,
    fallbackName,
    freePagePath,
    fs,
    list,
    path,
    paths,
    /** What the editors were last sent, as `publishList` keeps it. */
    published: () => published,
    publishList,
    readCanvas,
    relativeToDesigns,
    root,
    toPage,
    updateCanvas,
    updateFrames,
    updateRoutes,
    writeOrder,
  };
});

export type PagesReading = Effect.Success<typeof makePagesReading>;
