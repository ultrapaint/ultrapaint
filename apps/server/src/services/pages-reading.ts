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
  type FrameLayout,
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
import { Effect, FileSystem, Path } from "effect";
import { EventBus } from "../events.ts";
import { makeExists } from "../fs-exists.ts";
import { makeWalk } from "../fs-walk.ts";
import { toPosix } from "../hash.ts";
import { safeCanvasId } from "../ids.ts";
import { EditService, type EditTransaction } from "./edit.ts";
import {
  canvasIdsIn,
  decodeOrder,
  FRAME_GAP,
  followHome,
  IGNORED_DIRS,
  pageListOf,
  pageOf,
  parseCanvas,
  renderCanvas,
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
    const { layout } = yield* parseCanvas(text).pipe(
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

  const updateCanvas = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string,
    update: (layout: CanvasLayout) => CanvasLayout
  ) {
    const layout = yield* readCanvas(canvas);
    yield* tx.write(yield* canvasFile(canvas), renderCanvas(update(layout)));
  });

  /**
   * A page's text as the journal has it now. Read inside the action that writes from it, so
   * an edit to the page cannot land between the reading and the writing and be lost.
   */
  const contentOf = (file: string) =>
    Effect.map(edit.read(file), (source) => source.content);

  /** Rewrites the frames of a canvas; a missing source frame means there is nothing to do. */
  const updateFrames = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string,
    update: (frames: CanvasLayout["frames"]) => CanvasLayout["frames"] | null
  ) {
    const layout = yield* readCanvas(canvas);
    const frames = update(layout.frames);
    if (frames) {
      yield* tx.write(
        yield* canvasFile(canvas),
        renderCanvas({ ...layout, frames })
      );
    }
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

  /** The list as it is now, sent to the editors if it is not what they have. */
  const publishList = Effect.gen(function* () {
    const { files, pageList } = yield* scan;
    const json = JSON.stringify(pageList);
    const changed = json !== published?.json;
    published = { files: new Set(files), json };
    if (changed) {
      yield* events.publish("pages", pageList);
    }
    return pageList;
  });

  // ---- lifecycle ----
  /** The page of that id, in `all` when the caller has just listed the pages. */
  const byId = Effect.fnUntraced(function* (id: string, all?: PageList) {
    const page = (all ?? (yield* list)).pages.find((p) => p.id === id);
    if (!page) {
      return yield* new NotFound({ message: `page not found: ${id}` });
    }
    const abs = yield* paths.resolve(path.join(root, page.id));
    return { abs, page };
  });

  const canvasById = Effect.fnUntraced(function* (id: string) {
    const all = yield* list;
    const canvas = all.canvases.find((c) => c.id === id);
    if (!canvas) {
      return yield* new NotFound({ message: `canvas not found: ${id}` });
    }
    return { all, canvas };
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

  /** Beside the rightmost frame of the canvas, so a new page never lands on another. */
  const placeFrame = (
    frames: CanvasLayout["frames"],
    size: { readonly height: number; readonly width: number }
  ): FrameLayout => {
    const placed = Object.values(frames);
    const x =
      placed.length === 0
        ? 0
        : Math.max(...placed.map((f) => f.x + f.width)) + FRAME_GAP;
    return { ...size, preset: "custom", x, y: 0 };
  };

  return {
    byId,
    canvasById,
    canvasFile,
    canvasPath,
    checkRoute,
    contentOf,
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
    placeFrame,
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
