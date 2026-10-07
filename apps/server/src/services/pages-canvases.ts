/**
 * The pages service's canvas operations: making, renaming, reordering, duplicating and deleting
 * canvases, copying or moving pages from one to another, and where a canvas opens and its frames
 * sit. Each runs as one undo step and sends the editors the list it leaves.
 */

import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  ASSETS_DIR,
  type Canvas,
  type CanvasLayout,
  emptyCanvasLayout,
  type FrameLayout,
  type Page,
  type PageList,
} from "@ultrapaint/contracts/pages";
import { ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import { slugOf } from "@ultrapaint/shared/path";
import {
  basePathOf,
  matchRoute,
  normaliseRoute,
} from "@ultrapaint/shared/route";
import { Effect } from "effect";
import { COMMENTS_FILE, type CommentsService } from "./comments.ts";
import type { EditTransaction } from "./edit.ts";
import type { CopyTarget } from "./pages.ts";
import { renderCanvas } from "./pages-layout.ts";
import type { PagesReading } from "./pages-reading.ts";

export const makeCanvasOperations = (
  reading: PagesReading,
  comments: CommentsService["Service"]
) => {
  const {
    canvasById,
    canvasFile,
    canvasPath,
    checkRoute,
    contentOf,
    edit,
    exists,
    failIfExists,
    fallbackName,
    fs,
    list,
    path,
    paths,
    publishList,
    readCanvas,
    root,
    toPage,
    updateCanvas,
    updateFrames,
    updateRoutes,
    writeOrder,
  } = reading;

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

  const reorderCanvases = Effect.fn("PagesService.reorderCanvases")(function* (
    order: readonly string[]
  ) {
    const { canvases } = yield* list;
    const known = new Set(canvases.map((c) => c.id));
    const named = order.filter((id) => known.has(id));
    // What the request leaves out keeps its place after what it names.
    const rest = canvases.map((c) => c.id).filter((id) => !named.includes(id));
    yield* edit.transaction("Reorder the canvases", (tx) =>
      writeOrder(tx, [...named, ...rest])
    );
    yield* publishList;
  });

  const duplicateCanvas = Effect.fn("PagesService.duplicateCanvas")(function* (
    id: string,
    name: string
  ) {
    const trimmed = name.trim();
    if (trimmed === "") {
      return yield* new BadRequest({ message: "a canvas needs a name" });
    }
    const { all, canvas } = yield* canvasById(id);
    const copyId = yield* freeCanvasId(trimmed);
    const pages = all.pages.filter((p) => p.canvas === id);
    yield* edit.transaction(`Duplicate ${canvas.name} as ${trimmed}`, (tx) =>
      Effect.gen(function* () {
        // Read in the action, so an edit made meanwhile is copied rather than lost.
        const layout = yield* readCanvas(id);
        // Ids are unique within a document; a copy in a canvas of its own keeps them.
        yield* addCanvas(tx, all, copyId, { ...layout, name: trimmed }, id);
        for (const page of pages) {
          yield* tx.create(
            paths.relative(path.join(root, copyId, page.path)),
            yield* contentOf(page.file)
          );
        }
      })
    );
    // The root's assets are everyone's; another canvas's own go with it. Images stay out
    // of the journal, which holds text, as they do when they are uploaded.
    if (id !== ROOT_CANVAS) {
      const from = path.join(root, id, ASSETS_DIR);
      if (yield* exists(from)) {
        yield* fs.copy(from, path.join(root, copyId, ASSETS_DIR)).pipe(
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `the canvas was copied without its images: ${error.message}`,
              })
          )
        );
      }
    }
    const copied = (yield* publishList).canvases.find((c) => c.id === copyId);
    return (
      copied ?? {
        ...canvas,
        id: copyId,
        name: trimmed,
      }
    );
  });

  /**
   * Removes a directory once nothing is left in it, its empty subdirectories first. One that
   * cannot be read or removed is left: an empty directory is untidy, not wrong.
   */
  const removeEmptyDirs: (dir: string) => Effect.Effect<void> =
    Effect.fnUntraced(
      function* (dir: string) {
        const info = yield* fs.stat(dir);
        if (info.type !== "Directory") {
          return;
        }
        for (const name of yield* fs.readDirectory(dir)) {
          yield* removeEmptyDirs(path.join(dir, name));
        }
        // Removing a directory takes `recursive` even when it is empty, as this one just was.
        if ((yield* fs.readDirectory(dir)).length === 0) {
          yield* fs.remove(dir, { recursive: true });
        }
      },
      (effect) => Effect.ignore(effect)
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
    // The designs directory's own canvas leaves the directory and the shared assets to the
    // others. Another's own assets go with it, outside the journal as they came in: undo
    // brings the pages back, and their images stay gone, as an uploaded image would.
    if (id !== ROOT_CANVAS) {
      const dir = yield* paths.resolve(path.join(root, id));
      yield* fs
        .remove(path.join(dir, ASSETS_DIR), {
          force: true,
          recursive: true,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `the canvas's pages were deleted, its images not: ${error.message}`,
              })
          )
        );
      yield* removeEmptyDirs(dir);
    }
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
    const picked = all.pages.filter((p) => ids.includes(p.id));
    const [first] = picked;
    if (!first) {
      return yield* new BadRequest({ message: "no pages to copy" });
    }
    const from = first.canvas;
    if (picked.some((p) => p.canvas !== from)) {
      return yield* new BadRequest({
        message: "the pages to copy are in more than one canvas",
      });
    }
    // A base page's variants are drawings of it, and go wherever it goes.
    const bases = new Set(
      picked.filter((p) => p.variant === undefined).map((p) => p.path)
    );
    const chosen = all.pages.filter(
      (p) =>
        p.canvas === from &&
        (ids.includes(p.id) || bases.has(basePathOf(p.path)))
    );
    const creating = "name" in target;
    const targetName = creating
      ? target.name.trim()
      : (all.canvases.find((c) => c.id === target.canvas)?.name ??
        target.canvas);
    if (creating && targetName === "") {
      return yield* new BadRequest({ message: "a canvas needs a name" });
    }
    const to = creating
      ? yield* freeCanvasId(targetName)
      : (yield* canvasById(target.canvas)).canvas.id;
    if (to === from) {
      return yield* new BadRequest({
        message: "the pages are in that canvas already",
      });
    }
    const entries = yield* Effect.forEach(chosen, (page) =>
      Effect.gen(function* () {
        const abs = yield* paths.resolve(path.join(root, to, page.path));
        yield* failIfExists(abs);
        return { abs, page };
      })
    );
    const carried = yield* carriedRoutes(all, chosen, creating ? null : to);
    const variants = [
      ...new Set(
        chosen.flatMap((p) => (p.variant === undefined ? [] : [p.variant]))
      ),
    ];
    const verb = move ? "Move" : "Copy";
    const what = picked.length === 1 ? first.name : `${picked.length} pages`;
    const gone = (key: string) => chosen.some((p) => p.path === key);
    yield* edit.transaction(`${verb} ${what} to ${targetName}`, (tx) =>
      Effect.gen(function* () {
        // Read in the action, so an edit made meanwhile is carried rather than lost.
        const source = yield* readCanvas(from);
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
        for (const { abs, page } of entries) {
          yield* tx.create(paths.relative(abs), yield* contentOf(page.file));
        }
        if (move) {
          for (const { page } of entries) {
            yield* tx.remove(page.file);
          }
          // The conversation about a page goes where the page goes; a copy starts without.
          const before = yield* comments.rewrite(tx, from, (left) =>
            left.filter((c) => !gone(c.page))
          );
          const carriedComments = before.filter((c) => gone(c.page));
          if (carriedComments.length > 0) {
            yield* comments.rewrite(tx, to, (there) => [
              ...there,
              ...carriedComments,
            ]);
          }
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

  const setHome = Effect.fn("PagesService.setHome")(function* (
    id: string,
    route: string
  ) {
    const { all, canvas } = yield* canvasById(id);
    const trimmed = route.trim();
    if (trimmed === "") {
      return yield* new BadRequest({
        message: "a canvas opens on a URL; name one",
      });
    }
    const home = normaliseRoute(
      trimmed.startsWith("/") ? trimmed : `/${trimmed}`
    );
    // A home no page serves would open the prototype on nothing.
    const served = all.pages.filter(
      (p) => p.canvas === id && p.variant === undefined
    );
    if (!matchRoute(served, home)) {
      return yield* new BadRequest({
        message: `no page of ${canvas.name} serves ${home}; give a page that URL first`,
      });
    }
    yield* edit.transaction(`Open ${canvas.name} on ${home}`, (tx) =>
      updateCanvas(tx, id, (layout) => ({ ...layout, home }))
    );
    yield* publishList;
    return { ...canvas, home } satisfies Canvas;
  });

  const writeFrames = Effect.fn("PagesService.writeFrames")(function* (
    canvas: string,
    frames: Record<string, FrameLayout>
  ) {
    const all = yield* list;
    // Frames are saved for a canvas there is; they do not make one.
    if (!all.canvases.some((c) => c.id === canvas)) {
      return yield* new NotFound({
        message: `canvas not found: ${canvas}`,
      });
    }
    // The editor's frames may be older than a page renamed, moved or deleted since: a frame
    // of a page that is gone would be brought back under its old name.
    const present = new Set(
      all.pages.filter((p) => p.canvas === canvas).map((p) => p.path)
    );
    yield* edit.transaction("Arrange the canvas", (tx) =>
      updateCanvas(tx, canvas, (layout) => ({
        ...layout,
        frames: Object.fromEntries(
          Object.entries({ ...layout.frames, ...frames }).filter(([key]) =>
            present.has(key)
          )
        ),
      }))
    );
  });

  const setFrame = Effect.fn("PagesService.setFrame")(function* (
    canvas: string,
    pagePath: string,
    frame: (
      before: FrameLayout | undefined,
      frames: CanvasLayout["frames"]
    ) => FrameLayout
  ) {
    const page = (yield* list).pages.find(
      (p) => p.canvas === canvas && p.path === pagePath
    );
    if (!page) {
      return yield* new NotFound({
        message: `page not found: ${pagePath}`,
      });
    }
    return yield* edit.transaction(`Size ${page.name}`, (tx) =>
      Effect.gen(function* () {
        // The layout as it is now, so nothing written since is put back.
        const layout = yield* readCanvas(canvas);
        const next = frame(layout.frames[pagePath], layout.frames);
        yield* tx.write(
          yield* canvasFile(canvas),
          renderCanvas({
            ...layout,
            frames: { ...layout.frames, [pagePath]: next },
          })
        );
        return next;
      })
    );
  });

  return {
    copyTo,
    createCanvas,
    deleteCanvas,
    duplicateCanvas,
    renameCanvas,
    reorderCanvases,
    setFrame,
    setHome,
    writeFrames,
  };
};
