import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import type { PageDocument } from "@ultrapaint/contracts/document";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  ASSETS_DIR,
  type Canvas,
  CanvasLayout,
  CanvasOrder,
  emptyCanvasLayout,
  type FrameLayout,
  type Page,
  type PageList,
} from "@ultrapaint/contracts/pages";
import { SKILL_EXTENSION, SKILLS_DIR } from "@ultrapaint/contracts/skills";
import {
  pageTemplates,
  renderTemplate,
  serialise,
} from "@ultrapaint/design-document/factories";
import { fillIds } from "@ultrapaint/design-document/ids";
import { isPageFile, PAGE_EXTENSION } from "@ultrapaint/design-document/tree";
import {
  CANVAS_FILE,
  CANVASES_FILE,
  canvasIdOf,
  canvasIdsFrom,
  orderCanvases,
  pathInCanvas,
  ROOT_CANVAS,
} from "@ultrapaint/shared/canvas";
import { basename, dirname, humanise, slugOf } from "@ultrapaint/shared/path";
import {
  basePathOf,
  isVariantName,
  normaliseRoute,
  pageNameOf,
  pageRouteOf,
  routesOf,
  variantOf,
  variantPathOf,
} from "@ultrapaint/shared/route";
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
import { makeWalk } from "../fs-walk.ts";
import { hashContent, toPosix } from "../hash.ts";
import { COMMENTS_FILE } from "./comments.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";

const IGNORED_DIRS = new Set(["node_modules", ".ultrapaint", "dist", ".vite"]);
/** Room left between a new frame and the one it is placed after. */
const FRAME_GAP = 80;
const SEGMENT_RE = /[\\/]/;

const decodeCanvas = Schema.decodeUnknownEffect(CanvasLayout);
const decodeOrder = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CanvasOrder)
);

/**
 * A layout from the text of `canvas.json`, with the ids its nodes leave out filled in. Nodes
 * are the canvas's document; ids are what an operation names them by.
 */
export const parseCanvas = (text: string) =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      catch: (error) =>
        new Conflict({ message: `canvas.json is not JSON: ${String(error)}` }),
      try: () => JSON.parse(text) as unknown,
    });
    const filled = fillIds(json);
    const layout = yield* decodeCanvas(json).pipe(
      Effect.mapError(
        (error) =>
          new Conflict({ message: `canvas.json is invalid: ${error.message}` })
      )
    );
    return { filled, layout };
  });

const sortedKeys = <T>(record: Readonly<Record<string, T>>) =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

/**
 * `canvas.json` as it is written: what it is called first, keys sorted, and no empty list. The
 * routes are written even when there are none, since their absence means a canvas from before
 * pages had optional URLs.
 */
export const renderCanvas = (layout: CanvasLayout) => {
  const nodes = layout.nodes ?? [];
  const variants = layout.variants ?? [];
  return serialise({
    ...(layout.name !== undefined && { name: layout.name }),
    ...(layout.home !== undefined && { home: layout.home }),
    ...(variants.length > 0 && { variants }),
    ...(layout.routes !== undefined && { routes: sortedKeys(layout.routes) }),
    frames: sortedKeys(layout.frames),
    ...(nodes.length > 0 && { nodes }),
    version: 1,
  });
};

/** The canvases a set of designs-relative files makes: one per `canvas.json`, or the root. */
export const canvasIdsIn = (files: readonly string[]): string[] => {
  const ids = canvasIdsFrom(
    files.filter((file) => basename(file) === CANVAS_FILE)
  );
  return ids.length === 0 ? [ROOT_CANVAS] : ids;
};

/** A page from its canvas, its path inside it and the canvas's routes. */
export const pageOf = (
  canvas: string,
  pagePath: string,
  id: string,
  file: string,
  routes: CanvasLayout["routes"]
): Page => {
  const route = pageRouteOf(routes, pagePath);
  const variant = variantOf(pagePath);
  return {
    canvas,
    file,
    id,
    name: pageNameOf(pagePath),
    path: pagePath,
    ...(route !== undefined && { route }),
    ...(variant !== null && { variant }),
  };
};

/**
 * The canvases and pages a set of files makes, whether they are on disk or kept by a snapshot:
 * `files` are relative to the designs directory, `layouts` the canvases' `canvas.json`.
 */
export const pageListOf = (input: {
  readonly files: readonly string[];
  /** The repository-relative file of a designs-relative one. */
  readonly fileOf: (rel: string) => string;
  readonly layouts: Readonly<Record<string, CanvasLayout>>;
  readonly order: readonly string[];
  /** What the designs directory's own canvas is called when its canvas.json does not say. */
  readonly rootName: string;
}): PageList => {
  const ids = canvasIdsIn(input.files);
  const explicit = ids.length === 1 && ids[0] === ROOT_CANVAS ? [] : ids;
  const pages: Page[] = [];
  for (const rel of input.files) {
    if (!isPageFile(basename(rel))) {
      continue;
    }
    const canvas = canvasIdOf(explicit, rel);
    // A page file that no canvas holds is not a page: it sits beside the canvases.
    if (canvas !== null) {
      pages.push(
        pageOf(
          canvas,
          pathInCanvas(canvas, rel),
          rel,
          input.fileOf(rel),
          input.layouts[canvas]?.routes
        )
      );
    }
  }
  const canvases = ids.map((id): Canvas => {
    const layout = input.layouts[id] ?? emptyCanvasLayout();
    const listed = layout.variants ?? [];
    const drawn = pages
      .flatMap((p) =>
        p.canvas === id && p.variant !== undefined ? [p.variant] : []
      )
      .filter((v) => !listed.includes(v))
      .sort((a, b) => a.localeCompare(b));
    return {
      home: normaliseRoute(layout.home ?? "/"),
      id,
      name: layout.name ?? (id === ROOT_CANVAS ? input.rootName : humanise(id)),
      variants: [...new Set([...listed, ...drawn])],
    };
  });
  return { canvases: orderCanvases(canvases, input.order), pages };
};

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
    /** The page drawn again for a variant, in the variant's file, its frame under the page's. */
    readonly createVariant: (
      id: string,
      variant: string
    ) => Effect.Effect<Page, PagesFailure>;
    /** Pages copied or moved into another canvas, with the same URLs. */
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
    readonly delete: (id: string) => Effect.Effect<void, PagesFailure>;
    readonly duplicate: (id: string) => Effect.Effect<Page, PagesFailure>;
    readonly list: Effect.Effect<PageList>;
    /** The layout of a canvas: its frames and the nodes on it. */
    readonly readCanvas: (
      canvas: string
    ) => Effect.Effect<CanvasLayout, Conflict>;
    /** Repo-relative path of a canvas's `canvas.json`. */
    readonly canvasFile: (canvas: string) => Effect.Effect<string, EditFailure>;
    /** Renames the page, which moves its file and its variants'; its URL stays. */
    readonly rename: (
      id: string,
      name: string
    ) => Effect.Effect<Page, PagesFailure>;
    /** The URL the page serves from now on, or none; a variant's is its base page's. */
    readonly setRoute: (
      id: string,
      route: string | null
    ) => Effect.Effect<Page, PagesFailure>;
    readonly templates: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    /** Changes the layout inside an action, which the change becomes part of. */
    readonly updateCanvas: (
      tx: EditTransaction,
      canvas: string,
      update: (layout: CanvasLayout) => CanvasLayout
    ) => Effect.Effect<void, PagesFailure | Conflict>;
    /** Saves where the frames are as the editor has them: one undo step when anything moved. */
    readonly writeFrames: (
      canvas: string,
      frames: Record<string, FrameLayout>
    ) => Effect.Effect<void, PagesFailure>;
  }
>()("ultrapaint/server/PagesService") {
  static readonly layer = Layer.effect(
    PagesService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const walk = makeWalk(fs, path);
      const root = paths.designsDir;
      // Renames, duplicates and deletes pick a file name and rewrite `canvas.json`; two at
      // once would choose the same name or lose each other's frame.
      const mutations = yield* Semaphore.make(1);
      const exclusive = mutations.withPermits(1);

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const relativeToDesigns = (abs: string) =>
        toPosix(path.relative(root, abs));

      // ---- canvas layout ----
      const canvasPath = (canvas: string) =>
        path.join(root, canvas, CANVAS_FILE);

      const readCanvas = Effect.fn("PagesService.readCanvas")(function* (
        canvas: string
      ) {
        const file = canvasPath(canvas);
        if (!(yield* exists(file))) {
          return emptyCanvasLayout();
        }
        const text = yield* Effect.orDie(fs.readFileString(file));
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
        return paths.relative(yield* paths.resolve(canvasPath(canvas)));
      });

      const updateCanvas = Effect.fnUntraced(function* (
        tx: EditTransaction,
        canvas: string,
        update: (layout: CanvasLayout) => CanvasLayout
      ) {
        const layout = yield* readCanvas(canvas);
        yield* tx.write(
          yield* canvasFile(canvas),
          renderCanvas(update(layout))
        );
      });

      const writeFrames = Effect.fn("PagesService.writeFrames")(function* (
        canvas: string,
        frames: Record<string, FrameLayout>
      ) {
        yield* edit.transaction("Arrange the canvas", (tx) =>
          updateCanvas(tx, canvas, (layout) => ({ ...layout, frames }))
        );
      });

      /** Rewrites the frames of a canvas; a missing source frame means there is nothing to do. */
      const updateFrames = Effect.fnUntraced(function* (
        tx: EditTransaction,
        canvas: string,
        update: (
          frames: CanvasLayout["frames"]
        ) => CanvasLayout["frames"] | null
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
          Effect.flatMap(Effect.orDie(fs.readFileString(orderPath)), (text) =>
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
          IGNORED_DIRS.has(name) ||
          name.startsWith(".") ||
          name.startsWith("_"),
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
          layout.routes
        );
      });

      const list: Effect.Effect<PageList> = Effect.gen(function* () {
        const files = (yield* found).map(relativeToDesigns);
        const ids = canvasIdsIn(files);
        // A canvas.json that cannot be read is reported when it is opened; the list still has it.
        const layouts = yield* Effect.forEach(ids, (id) =>
          Effect.map(
            Effect.orElseSucceed(readCanvas(id), () => emptyCanvasLayout()),
            (layout) => [id, layout] as const
          )
        );
        return pageListOf({
          fileOf: (rel) => paths.relative(path.join(root, rel)),
          files,
          layouts: Object.fromEntries(layouts),
          order: yield* readOrder,
          rootName: fallbackName(ROOT_CANVAS),
        });
      }).pipe(Effect.withSpan("PagesService.list"));

      const publishList = Effect.flatMap(list, (pageList) =>
        events.publish("pages", pageList)
      );

      // ---- lifecycle ----
      const byId = Effect.fnUntraced(function* (id: string) {
        const page = (yield* list).pages.find((p) => p.id === id);
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
       * out first, from its pages' paths, so its other pages keep the URLs they serve.
       */
      const updateRoutes = (
        tx: EditTransaction,
        all: PageList,
        canvas: string,
        update: (routes: Record<string, string>) => Record<string, string>
      ) =>
        updateCanvas(tx, canvas, (layout) => ({
          ...layout,
          routes: update(
            routesOf(
              layout.routes,
              all.pages
                .filter((p) => p.canvas === canvas && p.variant === undefined)
                .map((p) => p.path)
            )
          ),
        }));

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

      const createWith = Effect.fn("PagesService.createWith")(function* (
        canvas: string,
        page: NewPage,
        document: PageDocument,
        frame?: { readonly height: number; readonly width: number }
      ) {
        const name = page.name.trim();
        if (name === "") {
          return yield* new BadRequest({ message: "a page needs a name" });
        }
        const all = yield* list;
        const route =
          page.route === undefined || page.route.trim() === ""
            ? undefined
            : yield* checkRoute(all, canvas, page.route);
        const pagePath = yield* freePagePath(canvas, "", name);
        const abs = yield* paths.resolve(path.join(root, canvas, pagePath));
        yield* edit.transaction(`Create ${name}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.create(paths.relative(abs), serialise(document));
            // Written even without a URL: the page is one, and a canvas without routes would
            // give it the one its path names.
            yield* updateRoutes(tx, all, canvas, (routes) =>
              route === undefined ? routes : { ...routes, [pagePath]: route }
            );
            if (frame) {
              yield* updateFrames(tx, canvas, (frames) => ({
                ...frames,
                [pagePath]: placeFrame(frames, frame),
              }));
            }
          })
        );
        yield* publishList;
        return yield* toPage(canvas, pagePath, abs);
      });

      const create = (canvas: string, page: NewPage, templateId = "blank") =>
        createWith(
          canvas,
          page,
          renderTemplate(templateId, page.name.trim())
        ).pipe(Effect.withSpan("PagesService.create"));

      // ---- canvases ----
      /**
       * A directory for a new canvas: its name made safe, numbered past what is there. A
       * directory that exists is never taken over, since its pages belong to a canvas already.
       */
      const freeCanvasId = Effect.fnUntraced(function* (name: string) {
        const base = slugOf(name);
        let id = base;
        for (let n = 2; yield* exists(path.join(root, id)); n += 1) {
          id = `${base}-${n}`;
        }
        yield* paths.resolve(path.join(root, id));
        return id;
      });

      /**
       * Writes the `canvas.json` of a new canvas, and the order with it placed after `after`
       * (last when not given). The first canvas made beside an implicit root would leave the
       * root's pages to no canvas at all, so the root is made a canvas of its own first.
       */
      const addCanvas = Effect.fnUntraced(function* (
        tx: EditTransaction,
        all: PageList,
        id: string,
        layout: CanvasLayout,
        after?: string
      ) {
        const rootFile = canvasPath(ROOT_CANVAS);
        const rootIsImplicit =
          all.canvases.length === 1 &&
          all.canvases[0]?.id === ROOT_CANVAS &&
          !(yield* exists(rootFile));
        if (rootIsImplicit && all.pages.some((p) => p.canvas === ROOT_CANVAS)) {
          yield* tx.write(
            paths.relative(rootFile),
            renderCanvas({
              ...emptyCanvasLayout(),
              name: fallbackName(ROOT_CANVAS),
            })
          );
        }
        yield* tx.create(paths.relative(canvasPath(id)), renderCanvas(layout));
        const order = all.canvases.map((c) => c.id);
        const at = after === undefined ? -1 : order.indexOf(after);
        yield* writeOrder(
          tx,
          at === -1
            ? [...order, id]
            : [...order.slice(0, at + 1), id, ...order.slice(at + 1)]
        );
      });

      const createCanvas = Effect.fn("PagesService.createCanvas")(function* (
        name: string
      ) {
        const trimmed = name.trim();
        if (trimmed === "") {
          return yield* new BadRequest({ message: "a canvas needs a name" });
        }
        const id = yield* freeCanvasId(trimmed);
        const all = yield* list;
        yield* edit.transaction(`Create the canvas ${trimmed}`, (tx) =>
          addCanvas(tx, all, id, {
            ...emptyCanvasLayout(),
            name: trimmed,
            routes: {},
          })
        );
        yield* publishList;
        return { home: "/", id, name: trimmed, variants: [] } satisfies Canvas;
      });

      const renameCanvas = Effect.fn("PagesService.renameCanvas")(function* (
        id: string,
        name: string
      ) {
        const trimmed = name.trim();
        if (trimmed === "") {
          return yield* new BadRequest({ message: "a canvas needs a name" });
        }
        const { canvas } = yield* canvasById(id);
        yield* edit.transaction(`Rename ${canvas.name} to ${trimmed}`, (tx) =>
          updateCanvas(tx, id, (layout) => ({ ...layout, name: trimmed }))
        );
        yield* publishList;
        return { ...canvas, name: trimmed } satisfies Canvas;
      });

      const reorderCanvases = Effect.fn("PagesService.reorderCanvases")(
        function* (order: readonly string[]) {
          const { canvases } = yield* list;
          const known = new Set(canvases.map((c) => c.id));
          const named = order.filter((id) => known.has(id));
          // What the request leaves out keeps its place after what it names.
          const rest = canvases
            .map((c) => c.id)
            .filter((id) => !named.includes(id));
          yield* edit.transaction("Reorder the canvases", (tx) =>
            writeOrder(tx, [...named, ...rest])
          );
          yield* publishList;
        }
      );

      const duplicateCanvas = Effect.fn("PagesService.duplicateCanvas")(
        function* (id: string, name: string) {
          const trimmed = name.trim();
          if (trimmed === "") {
            return yield* new BadRequest({ message: "a canvas needs a name" });
          }
          const { all, canvas } = yield* canvasById(id);
          const copyId = yield* freeCanvasId(trimmed);
          const layout = yield* readCanvas(id);
          const pages = all.pages.filter((p) => p.canvas === id);
          const contents = yield* Effect.forEach(pages, (page) =>
            Effect.map(
              Effect.orDie(fs.readFileString(path.join(root, page.id))),
              (content) => ({ content, page })
            )
          );
          yield* edit.transaction(
            `Duplicate ${canvas.name} as ${trimmed}`,
            (tx) =>
              Effect.gen(function* () {
                // Ids are unique within a document; a copy in a canvas of its own keeps them.
                yield* addCanvas(
                  tx,
                  all,
                  copyId,
                  { ...layout, name: trimmed },
                  id
                );
                for (const { content, page } of contents) {
                  yield* tx.create(
                    paths.relative(path.join(root, copyId, page.path)),
                    content
                  );
                }
              })
          );
          // The root's assets are everyone's; another canvas's own go with it. Images stay out
          // of the journal, which holds text, as they do when they are uploaded.
          if (id !== ROOT_CANVAS) {
            const from = path.join(root, id, ASSETS_DIR);
            if (yield* exists(from)) {
              yield* Effect.orDie(
                fs.copy(from, path.join(root, copyId, ASSETS_DIR))
              );
            }
          }
          yield* publishList;
          const copied = (yield* list).canvases.find((c) => c.id === copyId);
          return (
            copied ?? {
              ...canvas,
              id: copyId,
              name: trimmed,
            }
          );
        }
      );

      const deleteCanvas = Effect.fn("PagesService.deleteCanvas")(function* (
        id: string
      ) {
        const { all, canvas } = yield* canvasById(id);
        if (all.canvases.length === 1) {
          return yield* new BadRequest({
            message: "the last canvas cannot be deleted",
          });
        }
        yield* edit.transaction(`Delete the canvas ${canvas.name}`, (tx) =>
          Effect.gen(function* () {
            for (const page of all.pages.filter((p) => p.canvas === id)) {
              yield* tx.remove(page.file);
            }
            yield* tx.remove(yield* canvasFile(id));
            yield* tx.remove(
              paths.relative(
                yield* paths.resolve(path.join(root, id, COMMENTS_FILE))
              )
            );
            yield* writeOrder(
              tx,
              all.canvases.map((c) => c.id).filter((c) => c !== id)
            );
          })
        );
        yield* publishList;
      });

      /**
       * The URLs pages copied into a canvas take along: none may be one the target serves
       * already. A new canvas (`null`) serves none yet.
       */
      const carriedRoutes = Effect.fnUntraced(function* (
        all: PageList,
        chosen: readonly Page[],
        target: string | null
      ) {
        const carried: Record<string, string> = {};
        for (const page of chosen) {
          if (page.variant === undefined && page.route !== undefined) {
            carried[page.path] =
              target === null
                ? page.route
                : yield* checkRoute(all, target, page.route);
          }
        }
        return carried;
      });

      const copyTo = Effect.fn("PagesService.copyTo")(function* (
        ids: readonly string[],
        target: CopyTarget,
        move: boolean
      ) {
        const all = yield* list;
        const chosen = all.pages.filter((p) => ids.includes(p.id));
        const [first] = chosen;
        if (!first) {
          return yield* new BadRequest({ message: "no pages to copy" });
        }
        const from = first.canvas;
        if (chosen.some((p) => p.canvas !== from)) {
          return yield* new BadRequest({
            message: "the pages to copy are in more than one canvas",
          });
        }
        const creating = "name" in target;
        const to = creating
          ? yield* freeCanvasId(target.name)
          : (yield* canvasById(target.canvas)).canvas.id;
        if (to === from) {
          return yield* new BadRequest({
            message: "the pages are in that canvas already",
          });
        }
        const targetName = creating
          ? target.name.trim()
          : (all.canvases.find((c) => c.id === to)?.name ?? to);
        const entries = yield* Effect.forEach(chosen, (page) =>
          Effect.gen(function* () {
            const abs = yield* paths.resolve(path.join(root, to, page.path));
            yield* failIfExists(abs);
            const content = yield* Effect.orDie(
              fs.readFileString(path.join(root, page.id))
            );
            return { abs, content, page };
          })
        );
        const source = yield* readCanvas(from);
        const carried = yield* carriedRoutes(all, chosen, creating ? null : to);
        const variants = [
          ...new Set(
            chosen.flatMap((p) => (p.variant === undefined ? [] : [p.variant]))
          ),
        ];
        const verb = move ? "Move" : "Copy";
        const what =
          chosen.length === 1 ? first.name : `${chosen.length} pages`;
        yield* edit.transaction(`${verb} ${what} to ${targetName}`, (tx) =>
          Effect.gen(function* () {
            const withFrames = (frames: CanvasLayout["frames"]) => ({
              ...frames,
              ...Object.fromEntries(
                chosen.flatMap((p) => {
                  const frame = source.frames[p.path];
                  return frame ? [[p.path, frame] as const] : [];
                })
              ),
            });
            const withVariants = (layout: CanvasLayout): CanvasLayout => {
              const listed = layout.variants ?? [];
              const added = variants.filter((v) => !listed.includes(v));
              return added.length > 0
                ? { ...layout, variants: [...listed, ...added] }
                : layout;
            };
            if (creating) {
              const fresh = { ...emptyCanvasLayout(), name: targetName };
              yield* addCanvas(
                tx,
                all,
                to,
                withVariants({
                  ...fresh,
                  frames: withFrames({}),
                  routes: carried,
                }),
                from
              );
            } else {
              yield* updateCanvas(tx, to, (layout) =>
                withVariants({ ...layout, frames: withFrames(layout.frames) })
              );
              yield* updateRoutes(tx, all, to, (routes) => ({
                ...routes,
                ...carried,
              }));
            }
            for (const { abs, content } of entries) {
              yield* tx.create(paths.relative(abs), content);
            }
            if (move) {
              for (const { page } of entries) {
                yield* tx.remove(page.file);
              }
              const gone = (key: string) => chosen.some((p) => p.path === key);
              yield* updateFrames(tx, from, (left) =>
                Object.fromEntries(
                  Object.entries(left).filter(([key]) => !gone(key))
                )
              );
              yield* updateRoutes(tx, all, from, (routes) =>
                Object.fromEntries(
                  Object.entries(routes).filter(([key]) => !gone(key))
                )
              );
            }
          })
        );
        yield* publishList;
        return yield* Effect.forEach(entries, ({ abs, page }) =>
          toPage(to, page.path, abs)
        );
      });

      // ---- pages ----
      /** Moves a key of a record to another, or leaves the record as it is when it has none. */
      const moveKey = <T>(
        record: Readonly<Record<string, T>>,
        moves: ReadonlyMap<string, string>
      ): Record<string, T> =>
        Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            moves.get(key) ?? key,
            value,
          ])
        );

      const rename = Effect.fn("PagesService.rename")(function* (
        id: string,
        name: string
      ) {
        const trimmed = name.trim();
        if (trimmed === "") {
          return yield* new BadRequest({ message: "a page needs a name" });
        }
        const all = yield* list;
        const { page } = yield* byId(id);
        if (page.variant !== undefined) {
          return yield* new BadRequest({
            message: `a variant's page is named after its base page: rename ${pageNameOf(page.path)}`,
          });
        }
        const dir = dirname(page.path);
        const stem = `${dir === "" ? "" : `${dir}/`}${slugOf(trimmed)}`;
        if (`${stem}${PAGE_EXTENSION}` === page.path) {
          return page;
        }
        const targetPath = yield* freePagePath(page.canvas, dir, trimmed);
        // The page's variants are named after it, and go with it.
        const moving = all.pages.filter(
          (p) => p.canvas === page.canvas && basePathOf(p.path) === page.path
        );
        const moves = new Map(
          moving.map((p) => [
            p.path,
            p.variant === undefined
              ? targetPath
              : variantPathOf(targetPath, p.variant),
          ])
        );
        const files = yield* Effect.forEach(moving, (p) =>
          Effect.gen(function* () {
            const from = yield* paths.resolve(path.join(root, p.id));
            const to = yield* paths.resolve(
              path.join(root, p.canvas, moves.get(p.path) ?? p.path)
            );
            yield* failIfExists(to);
            const content = yield* Effect.orDie(fs.readFileString(from));
            return { content, from, to };
          })
        );
        // A move is the old file gone and the new one there, which is also how it is undone.
        yield* edit.transaction(`Rename ${page.name} to ${trimmed}`, (tx) =>
          Effect.gen(function* () {
            for (const { content, from, to } of files) {
              yield* tx.create(paths.relative(to), content);
              yield* tx.remove(paths.relative(from));
            }
            yield* updateCanvas(tx, page.canvas, (layout) => ({
              ...layout,
              frames: moveKey(layout.frames, moves),
            }));
            yield* updateRoutes(tx, all, page.canvas, (routes) =>
              moveKey(routes, moves)
            );
          })
        );
        yield* publishList;
        return yield* toPage(
          page.canvas,
          targetPath,
          yield* paths.resolve(path.join(root, page.canvas, targetPath))
        );
      });

      const setRoute = Effect.fn("PagesService.setRoute")(function* (
        id: string,
        route: string | null
      ) {
        const all = yield* list;
        const { abs, page } = yield* byId(id);
        const basePath = basePathOf(page.path);
        const next =
          route === null || route.trim() === ""
            ? undefined
            : yield* checkRoute(all, page.canvas, route, basePath);
        const base = all.pages.find(
          (p) => p.canvas === page.canvas && p.path === basePath
        );
        if (next === page.route) {
          return page;
        }
        const label = base?.name ?? page.name;
        yield* edit.transaction(
          next === undefined
            ? `Take the URL off ${label}`
            : `Serve ${label} at ${next}`,
          (tx) =>
            updateRoutes(tx, all, page.canvas, (routes) => {
              const { [basePath]: _, ...rest } = routes;
              return next === undefined ? rest : { ...rest, [basePath]: next };
            })
        );
        yield* publishList;
        return yield* toPage(page.canvas, page.path, abs);
      });

      const duplicate = Effect.fn("PagesService.duplicate")(function* (
        id: string
      ) {
        const all = yield* list;
        const { abs, page } = yield* byId(id);
        // `pricing@bold` is copied as `pricing-2@bold`: the number goes to the name.
        const copyPath = yield* freePagePath(
          page.canvas,
          dirname(page.path),
          pageNameOf(page.path),
          page.variant
        );
        const target = yield* paths.resolve(
          path.join(root, page.canvas, copyPath)
        );
        // Ids are unique within a document; a copy in a file of its own keeps them.
        const content = yield* Effect.orDie(fs.readFileString(abs));
        yield* edit.transaction(`Duplicate ${page.name}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.create(paths.relative(target), content);
            // The copy serves no URL: two pages cannot serve one.
            yield* updateRoutes(tx, all, page.canvas, (routes) => routes);
            yield* updateFrames(tx, page.canvas, (frames) => {
              const frame = frames[page.path];
              return frame
                ? {
                    ...frames,
                    [copyPath]: {
                      ...frame,
                      x: frame.x + frame.width + FRAME_GAP,
                    },
                  }
                : null;
            });
          })
        );
        yield* publishList;
        return yield* toPage(page.canvas, copyPath, target);
      });

      const createVariant = Effect.fn("PagesService.createVariant")(function* (
        id: string,
        variant: string
      ) {
        const name = slugOf(variant);
        if (!isVariantName(name)) {
          return yield* new BadRequest({
            message: `a variant is named with letters, digits and dashes: ${variant}`,
          });
        }
        const { abs, page } = yield* byId(id);
        const basePath = basePathOf(page.path);
        const variantPath = variantPathOf(basePath, name);
        const target = yield* paths.resolve(
          path.join(root, page.canvas, variantPath)
        );
        if (yield* exists(target)) {
          return yield* new Conflict({
            message: `${page.name} has a ${name} variant already`,
          });
        }
        const content = yield* Effect.orDie(fs.readFileString(abs));
        yield* edit.transaction(`Draw ${page.name} for ${name}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.create(paths.relative(target), content);
            yield* updateCanvas(tx, page.canvas, (layout) => {
              const listed = layout.variants ?? [];
              const frame = layout.frames[page.path] ?? layout.frames[basePath];
              // Under the lowest frame of the page's column: a variant reads down from its base.
              const below = frame
                ? Math.max(
                    ...Object.values(layout.frames)
                      .filter((f) => f.x === frame.x)
                      .map((f) => f.y + f.height)
                  ) + FRAME_GAP
                : 0;
              return {
                ...layout,
                frames: frame
                  ? { ...layout.frames, [variantPath]: { ...frame, y: below } }
                  : layout.frames,
                variants: listed.includes(name) ? listed : [...listed, name],
              };
            });
          })
        );
        yield* publishList;
        return yield* toPage(page.canvas, variantPath, target);
      });

      const remove = Effect.fn("PagesService.delete")(function* (id: string) {
        const all = yield* list;
        const { abs, page } = yield* byId(id);
        yield* edit.transaction(`Delete ${page.name}`, (tx) =>
          Effect.gen(function* () {
            yield* tx.remove(paths.relative(abs));
            yield* updateFrames(tx, page.canvas, (frames) => {
              const { [page.path]: removed, ...rest } = frames;
              return removed ? rest : null;
            });
            if (page.variant === undefined) {
              yield* updateRoutes(tx, all, page.canvas, (routes) => {
                const { [page.path]: _, ...rest } = routes;
                return rest;
              });
            }
          })
        );
        yield* publishList;
      });

      // ---- watching ----
      const lastHash = new Map<string, string>();
      /** What each canvas.json said about its canvas, so a change of name re-reads the list. */
      const lastInfo = new Map<string, string>();

      const onCanvasChanged = Effect.fnUntraced(function* (abs: string) {
        const dir = relativeToDesigns(path.dirname(abs));
        const canvas = dir === "." ? ROOT_CANVAS : dir;
        // An invalid or vanished canvas.json is reported when the editor asks for it. Here it
        // must not end the watcher, so defects are caught along with failures.
        const layout = yield* Effect.exit(readCanvas(canvas));
        if (layout._tag === "Success") {
          yield* events.publish("canvas", { canvas, layout: layout.value });
          const { home, name, routes, variants } = layout.value;
          const info = JSON.stringify({ home, name, routes, variants });
          if (lastInfo.get(canvas) !== info) {
            lastInfo.set(canvas, info);
            yield* publishList;
          }
        }
      });

      /** A document written by someone else: an agent, a checkout, an editor. */
      const onFileChanged = Effect.fnUntraced(function* (abs: string) {
        // Give a non-atomic writer a moment to finish before hashing.
        yield* Effect.sleep("60 millis");
        const content = yield* Effect.option(fs.readFileString(abs));
        const hash = content._tag === "None" ? "" : hashContent(content.value);
        if (lastHash.get(abs) === hash) {
          return;
        }
        lastHash.set(abs, hash);
        yield* events.publish("file.changed", {
          file: paths.relative(abs),
          hash,
        });
      });

      const watched = fs.watch(root, { recursive: true }).pipe(
        Stream.filter(
          (event) =>
            !event.path.split(SEGMENT_RE).some((seg) => IGNORED_DIRS.has(seg))
        ),
        Stream.broadcast({ capacity: "unbounded", replay: 0 })
      );

      if (yield* exists(root)) {
        const stream = yield* watched;
        // Additions and removals, of pages or whole canvases, change the page list.
        yield* stream.pipe(
          Stream.filter((event) => event._tag !== "Update"),
          Stream.debounce("80 millis"),
          Stream.runForEach(() => publishList),
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
        yield* stream.pipe(
          Stream.mapEffect(
            (event) => {
              const abs = path.resolve(root, event.path);
              const name = path.basename(abs);
              if (name === CANVAS_FILE) {
                return Effect.andThen(onCanvasChanged(abs), onFileChanged(abs));
              }
              if (name === CANVASES_FILE && path.dirname(abs) === root) {
                return publishList;
              }
              const watchedFile =
                isPageFile(name) ||
                (path.dirname(abs) === root &&
                  (name === DESIGN_SYSTEM_FILE ||
                    name === DESIGN_NOTES_FILE)) ||
                (path.dirname(abs) === path.join(root, SKILLS_DIR) &&
                  name.endsWith(SKILL_EXTENSION));
              return watchedFile ? onFileChanged(abs) : Effect.void;
            },
            { concurrency: "unbounded" }
          ),
          Stream.runDrain,
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
      }

      return PagesService.of({
        canvasFile,
        copyTo: (ids, target, move) => exclusive(copyTo(ids, target, move)),
        create: (canvas, page, templateId) =>
          exclusive(create(canvas, page, templateId)),
        createCanvas: (name) => exclusive(createCanvas(name)),
        createVariant: (id, variant) => exclusive(createVariant(id, variant)),
        createWith: (canvas, page, document, frame) =>
          exclusive(createWith(canvas, page, document, frame)),
        delete: (id) => exclusive(remove(id)),
        deleteCanvas: (id) => exclusive(deleteCanvas(id)),
        duplicate: (id) => exclusive(duplicate(id)),
        duplicateCanvas: (id, name) => exclusive(duplicateCanvas(id, name)),
        list,
        readCanvas,
        rename: (id, name) => exclusive(rename(id, name)),
        renameCanvas: (id, name) => exclusive(renameCanvas(id, name)),
        reorderCanvases: (order) => exclusive(reorderCanvases(order)),
        setRoute: (id, route) => exclusive(setRoute(id, route)),
        templates: pageTemplates,
        updateCanvas,
        writeFrames: (canvas, frames) => exclusive(writeFrames(canvas, frames)),
      });
    })
  );
}
