/**
 * The pages service's page operations: making a page, from a template or a document made
 * elsewhere, renaming it, the URL it serves, duplicating it, drawing it for a variant and
 * deleting it. Each runs as one undo step, carries the page's comments, frame and links along,
 * and sends the editors the list it leaves.
 */
import type { Comment } from "@ultrapaint/contracts/comments";
import type { PageDocument } from "@ultrapaint/contracts/document";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import { emptyCanvasLayout } from "@ultrapaint/contracts/pages";
import {
  pageTemplates,
  renderTemplate,
} from "@ultrapaint/design-document/factories";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { PAGE_EXTENSION } from "@ultrapaint/design-document/tree";
import { dirname, slugOf } from "@ultrapaint/shared/path";
import {
  basePathOf,
  isVariantName,
  normaliseRoute,
  pageNameOf,
  variantPathOf,
} from "@ultrapaint/shared/route";
import { Effect } from "effect";
import type { CommentsService } from "./comments.ts";
import type { EditTransaction } from "./edit.ts";
import type { NewPage } from "./pages.ts";
import { FRAME_GAP, mapLinks } from "./pages-layout.ts";
import type { PagesReading } from "./pages-reading.ts";

export const makePageOperations = (
  reading: PagesReading,
  comments: CommentsService["Service"]
) => {
  const {
    byId,
    checkRoute,
    contentOf,
    edit,
    exists,
    failIfExists,
    freePagePath,
    fs,
    list,
    path,
    paths,
    placeFrame,
    publishList,
    readCanvas,
    root,
    toPage,
    updateCanvas,
    updateFrames,
    updateRoutes,
  } = reading;

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
    yield* edit.transaction(`Create ${name}`, (tx) =>
      Effect.gen(function* () {
        yield* tx.create(paths.relative(abs), serialiseDocument(document));
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

  /**
   * Rewrites the links of a canvas, in its pages and its loose nodes, inside an action:
   * `map` answers what a link becomes, or undefined to leave it.
   */
  const rewriteLinks = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string,
    map: (link: string) => string | undefined
  ) {
    const visit = (value: unknown) => mapLinks(value, map);
    // The pages as they are now, inside the action: a rename has already moved its files.
    const { pages } = yield* list;
    for (const page of pages.filter((p) => p.canvas === canvas)) {
      const text = yield* Effect.option(
        fs.readFileString(path.join(root, page.id))
      );
      if (text._tag === "None") {
        continue;
      }
      // A page that is not JSON keeps its links; the editor reports it when it is opened.
      const json = yield* Effect.option(
        Effect.try(() => JSON.parse(text.value) as unknown)
      );
      if (json._tag === "Some" && visit(json.value)) {
        yield* tx.write(page.file, serialiseDocument(json.value));
      }
    }
    const layout = yield* Effect.orElseSucceed(readCanvas(canvas), () =>
      emptyCanvasLayout()
    );
    const nodes = structuredClone(layout.nodes ?? []);
    if (visit(nodes)) {
      yield* updateCanvas(tx, canvas, (current) => ({ ...current, nodes }));
    }
  });

  const rename = Effect.fn("PagesService.rename")(function* (
    id: string,
    name: string
  ) {
    const trimmed = name.trim();
    if (trimmed === "") {
      return yield* new BadRequest({ message: "a page needs a name" });
    }
    const all = yield* list;
    const { page } = yield* byId(id, all);
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
        const from = paths.relative(
          yield* paths.resolve(path.join(root, p.id))
        );
        const to = yield* paths.resolve(
          path.join(root, p.canvas, moves.get(p.path) ?? p.path)
        );
        yield* failIfExists(to);
        return { from, to: paths.relative(to) };
      })
    );
    // A move is the old file gone and the new one there, which is also how it is undone.
    yield* edit.transaction(`Rename ${page.name} to ${trimmed}`, (tx) =>
      Effect.gen(function* () {
        for (const { from, to } of files) {
          // Read in the action, so an edit made meanwhile moves with the page.
          yield* tx.move(from, to);
        }
        yield* comments.rewrite(tx, page.canvas, (pinned) =>
          pinned.some((c) => moves.has(c.page))
            ? pinned.map((c): Comment => {
                const moved = moves.get(c.page);
                return moved === undefined ? c : { ...c, page: moved };
              })
            : pinned
        );
        yield* updateCanvas(tx, page.canvas, (layout) => ({
          ...layout,
          frames: moveKey(layout.frames, moves),
        }));
        yield* updateRoutes(tx, all, page.canvas, (routes) =>
          moveKey(routes, moves)
        );
        // Links name a page by its file: they follow it to its new one.
        yield* rewriteLinks(tx, page.canvas, (link) => moves.get(link));
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
    const { abs, page } = yield* byId(id, all);
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
        Effect.gen(function* () {
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
        })
    );
    yield* publishList;
    return yield* toPage(page.canvas, page.path, abs);
  });

  const duplicate = Effect.fn("PagesService.duplicate")(function* (id: string) {
    const all = yield* list;
    const { page } = yield* byId(id, all);
    // `pricing@bold` is copied as `pricing-2@bold`: the number goes to the name.
    const copyPath = yield* freePagePath(
      page.canvas,
      dirname(page.path),
      pageNameOf(page.path),
      page.variant
    );
    const target = yield* paths.resolve(path.join(root, page.canvas, copyPath));
    yield* edit.transaction(`Duplicate ${page.name}`, (tx) =>
      Effect.gen(function* () {
        // Ids are unique within a document; a copy in a file of its own keeps them. Read in
        // the action, so an edit made meanwhile is copied rather than lost.
        yield* tx.create(paths.relative(target), yield* contentOf(page.file));
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
    const { page } = yield* byId(id);
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
    yield* edit.transaction(`Draw ${page.name} for ${name}`, (tx) =>
      Effect.gen(function* () {
        // Read in the action, so an edit made meanwhile is drawn again too.
        yield* tx.create(paths.relative(target), yield* contentOf(page.file));
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
    const { page } = yield* byId(id, all);
    // A base page's variants are drawings of it: they would be left serving nothing.
    const going =
      page.variant === undefined
        ? all.pages.filter(
            (p) => p.canvas === page.canvas && basePathOf(p.path) === page.path
          )
        : [page];
    const gone = new Set(going.map((p) => p.path));
    const label =
      going.length > 1
        ? `Delete ${page.name} and its variants`
        : `Delete ${page.name}`;
    yield* edit.transaction(label, (tx) =>
      Effect.gen(function* () {
        for (const p of going) {
          yield* tx.remove(p.file);
        }
        yield* updateFrames(tx, page.canvas, (frames) =>
          Object.keys(frames).some((key) => gone.has(key))
            ? Object.fromEntries(
                Object.entries(frames).filter(([key]) => !gone.has(key))
              )
            : null
        );
        if (page.variant === undefined) {
          yield* updateRoutes(tx, all, page.canvas, (routes) => {
            const { [page.path]: _, ...rest } = routes;
            return rest;
          });
        }
        // Its comments go with it, and come back with it on undo.
        yield* comments.rewrite(tx, page.canvas, (pinned) =>
          pinned.some((c) => gone.has(c.page))
            ? pinned.filter((c) => !gone.has(c.page))
            : pinned
        );
      })
    );
    yield* publishList;
  });

  return {
    create,
    createVariant,
    createWith,
    duplicate,
    remove,
    rename,
    setRoute,
  };
};
