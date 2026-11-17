/**
 * The pages service's page operations: making a page, from a template or a document made
 * elsewhere, renaming it, the URL it serves, duplicating it, drawing it in a state and
 * deleting it. Each runs as one undo step, carries the page's comments, frame and links along,
 * and sends the editors the list it leaves.
 */
import {
  FRAME_GAP,
  familyOf,
  frameRight,
  placeFrame,
  placeFrameAt,
} from "@ultrapaint/contracts/canvas-layout";
import type { PageDocument } from "@ultrapaint/contracts/document";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  pageTemplates,
  renderTemplate,
} from "@ultrapaint/design-document/factories";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { PAGE_EXTENSION } from "@ultrapaint/design-document/tree";
import { dirname, slugOf } from "@ultrapaint/shared/path";
import {
  basePathOf,
  isSuffixName,
  normaliseRoute,
  pageNameOf,
  suffixedPathOf,
} from "@ultrapaint/shared/route";
import { Effect } from "effect";
import type { CommentsService } from "./comments.ts";
import type { NewPage } from "./pages.ts";
import { makePageMoves } from "./pages-moves.ts";
import type { PagesReading } from "./pages-reading.ts";
import { copyVariationsFile } from "./variations-file.ts";

/**
 * The pages deleting `asked` takes, each once, the first asked for first: a base page's states
 * are drawings of it, and would be left serving nothing.
 */
const goingWith = (pages: readonly Page[], asked: readonly Page[]) => {
  const going = new Map<string, Page>();
  for (const page of asked) {
    const base = page.state === undefined;
    const family = base
      ? familyOf(pages, page).filter((p) => p.id !== page.id)
      : [];
    for (const p of [page, ...family]) {
      going.set(p.id, p);
    }
  }
  return [...going.values()];
};

/** The undo step's name: the page, or how many, and the drawings that went with them. */
const deleteLabel = (asked: readonly Page[], gone: readonly Page[]) => {
  const [first] = asked;
  const what =
    asked.length === 1 && first ? first.name : `${asked.length} pages`;
  return gone.some((p) => p.state !== undefined)
    ? `Delete ${what} and ${asked.length === 1 ? "its" : "their"} states`
    : `Delete ${what}`;
};

export const makePageOperations = (
  reading: PagesReading,
  comments: CommentsService["Service"]
) => {
  const {
    byId,
    checkRoute,
    contentIn,
    edit,
    exists,
    freePagePath,
    list,
    path,
    paths,
    publishList,
    root,
    toPage,
    updateCanvas,
    updateFrames,
    updateRoutes,
  } = reading;

  const { movePages, rewriteLinks } = makePageMoves(reading, comments);

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
    const made = yield* edit.transaction(`Create ${name}`, (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        // A canvas is made by `createCanvas`, never by a page that names one there is not.
        if (!all.canvases.some((c) => c.id === canvas)) {
          return yield* new NotFound({
            message: `canvas not found: ${canvas}`,
          });
        }
        const route =
          page.route === undefined || page.route.trim() === ""
            ? undefined
            : yield* checkRoute(all, canvas, page.route);
        const pagePath = yield* freePagePath(canvas, "", name);
        const abs = yield* paths.resolve(path.join(root, canvas, pagePath));
        yield* tx.create(paths.relative(abs), serialiseDocument(document));
        // Written even without a URL: the page is one, and a canvas without routes would
        // give it the one its path names.
        yield* updateRoutes(tx, all, canvas, (routes) =>
          route === undefined ? routes : { ...routes, [pagePath]: route }
        );
        if (frame) {
          yield* updateFrames(tx, canvas, (frames) => ({
            ...frames,
            [pagePath]: placeFrame(frames, { ...frame, preset: "custom" }),
          }));
        }
        return { abs, pagePath };
      })
    );
    yield* publishList;
    return yield* toPage(canvas, made.pagePath, made.abs);
  });

  const create = Effect.fn("PagesService.create")(function* (
    canvas: string,
    page: NewPage,
    templateId = "blank"
  ) {
    // A template that is not there is a mistake to report, not a blank page to hand back.
    if (!pageTemplates.some((t) => t.id === templateId)) {
      return yield* new BadRequest({
        message: `no page template ${templateId}; the templates are ${pageTemplates.map((t) => t.id).join(", ")}`,
      });
    }
    return yield* createWith(
      canvas,
      page,
      renderTemplate(templateId, page.name.trim())
    );
  });

  // ---- pages ----
  const rename = Effect.fn("PagesService.rename")(function* (
    id: string,
    name: string
  ) {
    const trimmed = name.trim();
    if (trimmed === "") {
      return yield* new BadRequest({ message: "a page needs a name" });
    }
    const renamed = yield* edit.transaction("Rename a page", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const { page } = yield* byId(id, all);
        yield* tx.name(`Rename ${page.name} to ${trimmed}`);
        if (page.state !== undefined) {
          return yield* new BadRequest({
            message: `a state's page is named after its base page: rename ${pageNameOf(page.path)}`,
          });
        }
        const dir = dirname(page.path);
        const stem = `${dir === "" ? "" : `${dir}/`}${slugOf(trimmed)}`;
        if (`${stem}${PAGE_EXTENSION}` === page.path) {
          return { page, targetPath: null };
        }
        const targetPath = yield* freePagePath(page.canvas, dir, trimmed);
        // The page's states are named after it, and go with it.
        const moving = familyOf(all.pages, page);
        const moves = new Map(
          moving.map((p) => [
            p.path,
            p.state === undefined
              ? targetPath
              : suffixedPathOf(targetPath, p.state),
          ])
        );
        yield* movePages(
          tx,
          all,
          moving.map((p) => ({
            page: p,
            to: { canvas: p.canvas, path: moves.get(p.path) ?? p.path },
          }))
        );
        return { page, targetPath };
      })
    );
    if (renamed.targetPath === null) {
      return renamed.page;
    }
    const { page, targetPath } = renamed;
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
    const routed = yield* edit.transaction("Change a page's URL", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const { abs, page } = yield* byId(id, all);
        const basePath = basePathOf(page.path);
        const next =
          route === null || route.trim() === ""
            ? undefined
            : yield* checkRoute(all, page.canvas, route, basePath);
        const label =
          all.pages.find((p) => p.canvas === page.canvas && p.path === basePath)
            ?.name ?? page.name;
        if (next === page.route) {
          return { abs, changed: false, page };
        }
        yield* tx.name(
          next === undefined
            ? `Take the URL off ${label}`
            : `Serve ${label} at ${next}`
        );
        yield* updateRoutes(tx, all, page.canvas, (routes) => {
          const { [basePath]: _, ...rest } = routes;
          return next === undefined ? rest : { ...rest, [basePath]: next };
        });
        // Links that named the old URL would lead nowhere: they name the page itself now,
        // which no change of URL can break.
        const old = page.route;
        if (old !== undefined) {
          yield* rewriteLinks(tx, page.canvas, (link) =>
            link.startsWith("/") && normaliseRoute(link) === old
              ? basePath
              : undefined
          );
        }
        return { abs, changed: true, page };
      })
    );
    if (!routed.changed) {
      return routed.page;
    }
    yield* publishList;
    return yield* toPage(routed.page.canvas, routed.page.path, routed.abs);
  });

  const duplicate = Effect.fn("PagesService.duplicate")(function* (id: string) {
    const copied = yield* edit.transaction("Duplicate a page", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const { page } = yield* byId(id, all);
        yield* tx.name(`Duplicate ${page.name}`);
        // `orders@empty` is copied as `orders-2@empty`: the number goes to the name.
        const copyPath = yield* freePagePath(
          page.canvas,
          dirname(page.path),
          pageNameOf(page.path),
          page.state
        );
        const target = yield* paths.resolve(
          path.join(root, page.canvas, copyPath)
        );
        // Ids are unique within a document; a copy in a file of its own keeps them. Read in
        // the action, so an edit made meanwhile is copied rather than lost.
        yield* tx.create(
          paths.relative(target),
          yield* contentIn(tx, page.file)
        );
        // Its variations too, which name the same ids (ADR 0098).
        yield* copyVariationsFile(tx, page.file, paths.relative(target));
        // The copy serves no URL: two pages cannot serve one.
        yield* updateRoutes(tx, all, page.canvas, (routes) => routes);
        yield* updateFrames(tx, page.canvas, (frames) => {
          const frame = frames[page.path];
          // Beside its page, unless another page or its views are there.
          return frame
            ? {
                ...frames,
                [copyPath]: placeFrameAt(frames, {
                  ...frame,
                  x: frameRight(frame) + FRAME_GAP,
                }),
              }
            : null;
        });
        return { copyPath, page, target };
      })
    );
    yield* publishList;
    return yield* toPage(copied.page.canvas, copied.copyPath, copied.target);
  });

  /**
   * The page drawn again in a state (ADR 0030): a copy of the base page in the state's file,
   * its frame to the right of the page's row (past everything when that is taken), the state
   * listed in the canvas's `states`.
   */
  const createState = Effect.fn("PagesService.createState")(function* (
    id: string,
    state: string
  ) {
    const name = slugOf(state);
    if (!isSuffixName(name)) {
      return yield* new BadRequest({
        message: `a state is named with letters, digits and dashes: ${state}`,
      });
    }
    const drawn = yield* edit.transaction("Draw a state", (tx) =>
      Effect.gen(function* () {
        const { page } = yield* byId(id, yield* list);
        yield* tx.name(`Draw ${page.name} ${name}`);
        const basePath = basePathOf(page.path);
        const statePath = suffixedPathOf(basePath, name);
        const target = yield* paths.resolve(
          path.join(root, page.canvas, statePath)
        );
        if (yield* exists(target)) {
          return yield* new Conflict({
            message: `${page.name} has a ${name} state already`,
          });
        }
        const baseFile = paths.relative(path.join(root, page.canvas, basePath));
        // Read in the action, so an edit made meanwhile is drawn again too.
        yield* tx.create(
          paths.relative(target),
          yield* contentIn(tx, baseFile)
        );
        yield* updateCanvas(tx, page.canvas, (current) => {
          const listed = current.states ?? [];
          const frame = current.frames[basePath];
          // To the right of everything on the page's row: a state reads across from its base.
          // Past everything when another page or its views are there.
          const right = frame
            ? Math.max(
                ...Object.values(current.frames)
                  .filter((f) => f.y === frame.y)
                  .map(frameRight)
              ) + FRAME_GAP
            : 0;
          return {
            ...current,
            frames: frame
              ? {
                  ...current.frames,
                  [statePath]: placeFrameAt(current.frames, {
                    ...frame,
                    x: right,
                  }),
                }
              : current.frames,
            states: listed.includes(name) ? listed : [...listed, name],
          };
        });
        return { page, statePath, target };
      })
    );
    yield* publishList;
    return yield* toPage(drawn.page.canvas, drawn.statePath, drawn.target);
  });

  const remove = Effect.fn("PagesService.delete")(function* (
    ids: readonly string[]
  ) {
    const removed = yield* edit.transaction("Delete a page", (tx) =>
      Effect.gen(function* () {
        const all = yield* list;
        const asked = yield* Effect.forEach(ids, (id) =>
          Effect.map(byId(id, all), (found) => found.page)
        );
        const gone = goingWith(all.pages, asked);
        yield* tx.name(deleteLabel(asked, gone));
        // Their comments, frames, URLs and links to the code go with them, and come back with
        // them on undo.
        yield* movePages(
          tx,
          all,
          gone.map((p) => ({ page: p, to: null }))
        );
        return gone;
      })
    );
    yield* publishList;
    return removed;
  });

  return {
    create,
    createState,
    createWith,
    duplicate,
    remove,
    rename,
    setRoute,
  };
};
