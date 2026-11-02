/**
 * The pages service's canvas operations: making, renaming, reordering, duplicating and deleting
 * canvases, copying or moving pages from one to another, and where a canvas opens and its frames
 * sit. Each runs as one undo step and sends the editors the list it leaves.
 */

import {
  drawnFrame,
  type FrameSize,
  familyOf,
  sizeFrame,
} from "@ultrapaint/contracts/canvas-layout";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  ASSETS_DIR,
  type Canvas,
  type CanvasLayout,
  emptyCanvasLayout,
  type FrameLayout,
  type PageList,
} from "@ultrapaint/contracts/pages";
import { ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import { slugOf } from "@ultrapaint/shared/path";
import { matchRoute, normaliseRoute } from "@ultrapaint/shared/route";
import { Effect } from "effect";
import { canvasText } from "./canvas-files.ts";
import type { CommentsService } from "./comments.ts";
import { COMMENTS_FILE } from "./comments-file.ts";
import type { EditTransaction } from "./edit.ts";
import type { CopyTarget } from "./pages.ts";
import { makePageMoves } from "./pages-moves.ts";
import type { PagesReading } from "./pages-reading.ts";

export const makeCanvasOperations = (
  reading: PagesReading,
  comments: CommentsService["Service"]
) => {
  const {
    canvasById,
    canvasFile,
    canvasIn,
    canvasPath,
    contentIn,
    edit,
    exists,
    fallbackName,
    fs,
    list,
    path,
    paths,
    publishList,
    root,
    toPage,
    updateCanvas,
    writeOrder,
  } = reading;
  const { arriveIn, movePages } = makePageMoves(reading, comments);

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
        canvasText({
          ...emptyCanvasLayout(),
          name: fallbackName(ROOT_CANVAS),
        })
      );
    }
    yield* tx.create(paths.relative(canvasPath(id)), canvasText(layout));
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
    const made = yield* edit.transaction(`Create the canvas ${trimmed}`, (tx) =>
      Effect.gen(function* () {
        const id = yield* freeCanvasId(trimmed);
        yield* addCanvas(tx, yield* list, id, {
          ...emptyCanvasLayout(),
          name: trimmed,
          routes: {},
        });
        return id;
      })
    );
    yield* publishList;
    return {
      home: "/",
      id: made,
      name: trimmed,
      variants: [],
    } satisfies Canvas;
  });

  const renameCanvas = Effect.fn("PagesService.renameCanvas")(function* (
    id: string,
    name: string
  ) {
    const trimmed = name.trim();
    if (trimmed === "") {
      return yield* new BadRequest({ message: "a canvas needs a name" });
    }
    const canvas = yield* edit.transaction("Rename a canvas", (tx) =>
      Effect.gen(function* () {
        const before = yield* canvasById(id, yield* list);
        yield* tx.name(`Rename ${before.name} to ${trimmed}`);
        yield* updateCanvas(tx, id, (layout) => ({
          ...layout,
          name: trimmed,
        }));
        return before;
      })
    );
    yield* publishList;
    return { ...canvas, name: trimmed } satisfies Canvas;
  });

  const reorderCanvases = Effect.fn("PagesService.reorderCanvases")(function* (
    order: readonly string[]
  ) {
    yield* edit.transaction("Reorder the canvases", (tx) =>
      Effect.gen(function* () {
        const { canvases } = yield* list;
        const known = new Set(canvases.map((c) => c.id));
        const named = order.filter((id) => known.has(id));
        // What the request leaves out keeps its place after what it names.
        const rest = canvases
          .map((c) => c.id)
          .filter((id) => !named.includes(id));
        yield* writeOrder(tx, [...named, ...rest]);
      })
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
    const duplicated = yield* edit.transaction("Duplicate a canvas", (tx) =>
      Effect.gen(function* () {
        // Read in the action, so an edit made meanwhile is copied rather than lost.
        const all = yield* list;
        const canvas = yield* canvasById(id, all);
        yield* tx.name(`Duplicate ${canvas.name} as ${trimmed}`);
        const copyId = yield* freeCanvasId(trimmed);
        const layout = yield* canvasIn(tx, id);
        // Ids are unique within a document; a copy in a canvas of its own keeps them.
        yield* addCanvas(tx, all, copyId, { ...layout, name: trimmed }, id);
        for (const page of all.pages.filter((p) => p.canvas === id)) {
          yield* tx.create(
            paths.relative(path.join(root, copyId, page.path)),
            yield* contentIn(tx, page.file)
          );
        }
        return { canvas, copyId };
      })
    );
    const { copyId } = duplicated;
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
        ...duplicated.canvas,
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
    yield* edit.transaction("Delete a canvas", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const canvas = yield* canvasById(id, all);
        yield* tx.name(`Delete the canvas ${canvas.name}`);
        if (all.canvases.length === 1) {
          return yield* new BadRequest({
            message: "the last canvas cannot be deleted",
          });
        }
        // Its pages go with their links to the code (ADR 0030), which come back on undo.
        yield* movePages(
          tx,
          all,
          all.pages
            .filter((p) => p.canvas === id)
            .map((page) => ({ page, to: null }))
        );
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
        return canvas;
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
   * The pages to copy or move, with the variants and states of the base pages among them, which
   * are drawings of them and go wherever they go; and the canvas they go to, a new one made by
   * name. Inside the action.
   */
  const copying = Effect.fnUntraced(function* (
    all: PageList,
    ids: readonly string[],
    target: CopyTarget
  ) {
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
    const families = new Set(
      picked
        .filter((p) => p.variant === undefined && p.state === undefined)
        .flatMap((p) => familyOf(all.pages, p))
    );
    const chosen = all.pages.filter(
      (p) => ids.includes(p.id) || families.has(p)
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
      : (yield* canvasById(target.canvas, all)).id;
    if (to === from) {
      return yield* new BadRequest({
        message: "the pages are in that canvas already",
      });
    }
    const what = picked.length === 1 ? first.name : `${picked.length} pages`;
    return { chosen, creating, from, targetName, to, what };
  });

  const copyTo = Effect.fn("PagesService.copyTo")(function* (
    ids: readonly string[],
    target: CopyTarget,
    move: boolean
  ) {
    const copied = yield* edit.transaction(
      move ? "Move pages" : "Copy pages",
      (tx) =>
        Effect.gen(function* () {
          const all = yield* list;
          const { chosen, creating, from, targetName, to, what } =
            yield* copying(all, ids, target);
          yield* tx.name(`${move ? "Move" : "Copy"} ${what} to ${targetName}`);
          if (creating) {
            yield* addCanvas(
              tx,
              all,
              to,
              { ...emptyCanvasLayout(), name: targetName, routes: {} },
              from
            );
          }
          if (move) {
            // A page moved is still the design its code implements (ADR 0030), with its
            // comments: everything goes with it.
            yield* movePages(
              tx,
              all,
              chosen.map((page) => ({
                page,
                to: { canvas: to, path: page.path },
              }))
            );
          } else {
            // Read in the action, so an edit made meanwhile is carried rather than lost. A copy
            // is a new design: no comments, no link to the code.
            const source = yield* canvasIn(tx, from);
            for (const page of chosen) {
              yield* tx.create(
                paths.relative(
                  yield* paths.resolve(path.join(root, to, page.path))
                ),
                yield* contentIn(tx, page.file)
              );
            }
            yield* arriveIn(
              tx,
              all,
              to,
              chosen.map((page) => ({
                frame: source.frames[page.path],
                page,
                path: page.path,
              }))
            );
          }
          return { chosen, to };
        })
    );
    yield* publishList;
    return yield* Effect.forEach(copied.chosen, (page) =>
      Effect.flatMap(
        paths.resolve(path.join(root, copied.to, page.path)),
        (abs) => toPage(copied.to, page.path, abs)
      )
    );
  });

  const setHome = Effect.fn("PagesService.setHome")(function* (
    id: string,
    route: string
  ) {
    const trimmed = route.trim();
    if (trimmed === "") {
      return yield* new BadRequest({
        message: "a canvas opens on a URL; name one",
      });
    }
    const home = normaliseRoute(
      trimmed.startsWith("/") ? trimmed : `/${trimmed}`
    );
    const opened = yield* edit.transaction("Open a canvas on a URL", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const canvas = yield* canvasById(id, all);
        yield* tx.name(`Open ${canvas.name} on ${home}`);
        // A home no page serves would open the prototype on nothing.
        const served = all.pages.filter(
          (p) => p.canvas === id && p.variant === undefined
        );
        if (!matchRoute(served, home)) {
          return yield* new BadRequest({
            message: `no page of ${canvas.name} serves ${home}; give a page that URL first`,
          });
        }
        yield* updateCanvas(tx, id, (layout) => ({ ...layout, home }));
        return canvas;
      })
    );
    yield* publishList;
    return { ...opened, home } satisfies Canvas;
  });

  const writeFrames = Effect.fn("PagesService.writeFrames")(function* (
    canvas: string,
    frames: Record<string, FrameLayout>
  ) {
    yield* edit.transaction("Arrange the canvas", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        // Frames are saved for a canvas there is; they do not make one.
        if (!all.canvases.some((c) => c.id === canvas)) {
          return yield* new NotFound({
            message: `canvas not found: ${canvas}`,
          });
        }
        // The editor's frames may be older than a page renamed, moved or deleted since: a
        // frame of a page that is gone would be brought back under its old name.
        const present = new Set(
          all.pages.filter((p) => p.canvas === canvas).map((p) => p.path)
        );
        yield* updateCanvas(tx, canvas, (layout) => ({
          ...layout,
          frames: Object.fromEntries(
            Object.entries({ ...layout.frames, ...frames }).filter(([key]) =>
              present.has(key)
            )
          ),
        }));
      })
    );
  });

  const setFrame = Effect.fn("PagesService.setFrame")(function* (
    canvas: string,
    pagePath: string,
    size: FrameSize
  ) {
    const sized = yield* edit.transaction("Size a page", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const page = all.pages.find(
          (p) => p.canvas === canvas && p.path === pagePath
        );
        if (!page) {
          return yield* new NotFound({
            message: `page not found: ${pagePath}`,
          });
        }
        yield* tx.name(`Size ${page.name}`);
        const drawn = all.pages
          .filter((p) => p.canvas === canvas)
          .map((p) => p.path);
        // The layout as it is now, so nothing written since is put back. A page with no
        // frame saved yet is sized where the editor draws it.
        let frame = sizeFrame(drawnFrame(drawn, {}, pagePath), size);
        yield* updateCanvas(tx, canvas, (layout) => {
          frame = sizeFrame(drawnFrame(drawn, layout.frames, pagePath), size);
          return {
            ...layout,
            frames: { ...layout.frames, [pagePath]: frame },
          };
        });
        return frame;
      })
    );
    return sized;
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
