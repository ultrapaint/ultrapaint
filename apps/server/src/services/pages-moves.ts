/**
 * A page's move, with everything that follows it, in one function: renamed in its canvas, moved
 * to another, or gone. Inside the action that moves it, so that undo takes all of it back at once:
 *
 * - its file, which goes where it goes or away;
 * - its comments, renamed with it, carried to its new canvas, or taken away (ADR 0019);
 * - its frame and the URL it serves, likewise; the URL a canvas opens on follows its page;
 * - the links that name it by its file, in its canvas's pages, loose nodes and app components,
 *   renamed with it. A link never leaves its canvas: a page moved to another or gone leaves the
 *   links to it leading nowhere, as a link to a missing page always did;
 * - its link to the code and the design as it was implemented (ADR 0030), kept under its new id
 *   or taken away.
 *
 * A copy is a new design: it arrives in a canvas with its frame and URL (`arriveIn`), and with no
 * comments and no link to the code.
 */
import type { Comment } from "@ultrapaint/contracts/comments";
import {
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
} from "@ultrapaint/contracts/component-names";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import {
  IMPLEMENTATION_FILE,
  implementedFileOf,
} from "@ultrapaint/contracts/implementation";
import type {
  CanvasLayout,
  FrameLayout,
  Page,
  PageList,
} from "@ultrapaint/contracts/pages";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { applyOps } from "@ultrapaint/design-document/ops";
import {
  canvasRoot,
  childrenOf,
  idsOf,
} from "@ultrapaint/design-document/tree";
import { normaliseRoute } from "@ultrapaint/shared/route";
import { Effect } from "effect";
import type { CommentsService } from "./comments.ts";
import {
  componentText,
  readComponentFile,
  withTree,
} from "./component-files.ts";
import { pageText, parseDocument } from "./document-file.ts";
import type { EditTransaction } from "./edit.ts";
import { implementationCodec, rebind } from "./implementation-files.ts";
import type { PagesReading } from "./pages-reading.ts";

/** A page's id, from its canvas and its path inside it. */
export const idOf = (canvas: string, pagePath: string) =>
  canvas === "" ? pagePath : `${canvas}/${pagePath}`;

/** Where a page goes: a canvas and its path inside it, or nowhere. */
export interface PageMove {
  readonly page: Page;
  readonly to: { readonly canvas: string; readonly path: string } | null;
}

/** A page arriving in a canvas: its path there, and the frame it is drawn in, if it had one. */
export interface Arrival {
  readonly frame: FrameLayout | undefined;
  readonly page: Page;
  readonly path: string;
}

/** What a link becomes, or undefined to leave it. */
type LinkMap = (link: string) => string | undefined;

/** The operations that rewrite the links of a tree's nodes as `map` says. */
const linkOps = (root: DesignNode, map: LinkMap): DocOp[] => {
  const ops: DocOp[] = [];
  const visit = (node: DesignNode) => {
    const { link } = node as { readonly link?: unknown };
    const next = typeof link === "string" ? map(link) : undefined;
    if (next !== undefined && next !== link) {
      ops.push({ id: node.id, op: "update", set: { link: next } });
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return ops;
};

/** The tree with its links rewritten as `map` says; null when none changed. */
const relinked = (
  root: DesignNode,
  map: LinkMap,
  canvas: boolean
): DesignNode | null => {
  const ops = linkOps(root, map);
  return ops.length === 0
    ? null
    : applyOps(root, ops, { canvas, next: makeIdGenerator(idsOf(root)) }).root;
};

export const makePageMoves = (
  reading: PagesReading,
  comments: CommentsService["Service"]
) => {
  const {
    canvasIn,
    checkRoute,
    exists,
    failIfExists,
    fs,
    list,
    path,
    paths,
    root,
    updateCanvas,
    updateRoutes,
  } = reading;

  /** The links of a canvas's pages and loose nodes rewritten, inside an action. */
  const relinkCanvas = Effect.fnUntraced(function* (
    tx: EditTransaction,
    pages: readonly Page[],
    canvas: string,
    map: LinkMap
  ) {
    for (const page of pages) {
      const text = yield* tx.read(page.file);
      const parsed = text === null ? null : yield* parseDocument(text);
      // A page that does not read keeps its links; the editor reports it when it is opened.
      const next =
        parsed !== null && "root" in parsed
          ? relinked(parsed.root, map, false)
          : null;
      if (next) {
        yield* tx.write(page.file, pageText(next));
      }
    }
    const layout = yield* Effect.orElseSucceed(
      canvasIn(tx, canvas),
      (): CanvasLayout | null => null
    );
    const loose = layout && relinked(canvasRoot(layout.nodes ?? []), map, true);
    if (loose) {
      yield* updateCanvas(tx, canvas, (current) => ({
        ...current,
        nodes: childrenOf(loose),
      }));
    }
  });

  /** The links of the app components' trees rewritten, inside an action. */
  const relinkComponents = Effect.fnUntraced(function* (
    tx: EditTransaction,
    map: LinkMap
  ) {
    const dir = path.join(root, COMPONENTS_DIR);
    const names = yield* fs
      .readDirectory(dir)
      .pipe(Effect.orElseSucceed((): string[] => []));
    for (const name of names.filter((n) => n.endsWith(COMPONENT_EXTENSION))) {
      const file = paths.relative(path.join(dir, name));
      const text = yield* tx.read(file);
      const read = text === null ? null : readComponentFile(text);
      const app =
        read && "component" in read && read.component.origin === "app"
          ? read.component
          : null;
      const tree = app && relinked(app.tree, map, false);
      if (app && tree) {
        yield* tx.write(file, componentText(withTree(app, tree)));
      }
    }
  });

  /**
   * Rewrites the links of a canvas, in its pages and its loose nodes, inside an action, and in
   * the app components when no page of another canvas could be what a link names: a component is
   * every canvas's. Read as the action has them: a rename has already moved its files.
   */
  const rewriteLinks = Effect.fnUntraced(function* (
    tx: EditTransaction,
    canvas: string,
    map: LinkMap
  ) {
    const all = yield* list;
    yield* relinkCanvas(
      tx,
      all.pages.filter((p) => p.canvas === canvas),
      canvas,
      map
    );
    const elsewhere = all.pages.filter((p) => p.canvas !== canvas);
    yield* relinkComponents(tx, (link) =>
      elsewhere.some((p) =>
        link.startsWith("/")
          ? p.route === normaliseRoute(link)
          : p.path === link
      )
        ? undefined
        : map(link)
    );
  });

  /**
   * Pages arriving in a canvas, inside an action: their frames where they were, their URLs (none
   * may be one the canvas serves already), and the variants and states they are drawn for listed.
   */
  const arriveIn = Effect.fnUntraced(function* (
    tx: EditTransaction,
    all: PageList,
    canvas: string,
    arrivals: readonly Arrival[]
  ) {
    const carried: Record<string, string> = {};
    for (const { page, path: at } of arrivals) {
      if (page.variant === undefined && page.route !== undefined) {
        carried[at] = yield* checkRoute(all, canvas, page.route);
      }
    }
    const listedIn = (
      listed: readonly string[] | undefined,
      names: readonly (string | undefined)[]
    ) => {
      const added = [
        ...new Set(names.filter((n): n is string => n !== undefined)),
      ].filter((n) => !(listed ?? []).includes(n));
      return added.length > 0 ? [...(listed ?? []), ...added] : listed;
    };
    yield* updateCanvas(tx, canvas, (layout) => {
      const variants = listedIn(
        layout.variants,
        arrivals.map((a) => a.page.variant)
      );
      const states = listedIn(
        layout.states,
        arrivals.map((a) => a.page.state)
      );
      return {
        ...layout,
        frames: {
          ...layout.frames,
          ...Object.fromEntries(
            arrivals.flatMap(({ frame, path: at }) =>
              frame ? [[at, frame] as const] : []
            )
          ),
        },
        ...(variants !== undefined && { variants }),
        ...(states !== undefined && { states }),
      };
    });
    if (Object.keys(carried).length > 0) {
      yield* updateRoutes(tx, all, canvas, (routes) => ({
        ...routes,
        ...carried,
      }));
    }
  });

  /** The links to the code of the pages moved or gone, with the designs as they were implemented. */
  const rebindIn = Effect.fnUntraced(function* (
    tx: EditTransaction,
    moves: ReadonlyMap<string, string | null>
  ) {
    const file = paths.relative(path.join(root, IMPLEMENTATION_FILE));
    // A file that does not read is left as it is.
    const read = yield* tx
      .readDocument(file, implementationCodec)
      .pipe(Effect.catchTag("Conflict", () => Effect.succeed(null)));
    if (read === null) {
      return;
    }
    const { bound, items } = rebind(read.items, moves);
    if (bound.length === 0) {
      return;
    }
    yield* tx.write(file, implementationCodec.encode({ items, version: 1 }));
    for (const [from, to] of bound) {
      const kept = path.join(root, implementedFileOf(from));
      if (yield* exists(kept)) {
        yield* to === null
          ? tx.remove(paths.relative(kept))
          : tx.move(
              paths.relative(kept),
              paths.relative(path.join(root, implementedFileOf(to)))
            );
      }
    }
  });

  /** A canvas's side of the pages leaving it or renamed in it. */
  const leave = Effect.fnUntraced(function* (
    tx: EditTransaction,
    all: PageList,
    canvas: string,
    moves: readonly PageMove[]
  ) {
    const renamed = new Map(
      moves.flatMap(({ page, to }) =>
        to?.canvas === canvas ? [[page.path, to.path] as const] : []
      )
    );
    const leaving = new Set(
      moves.filter(({ to }) => to?.canvas !== canvas).map((m) => m.page.path)
    );
    const before = yield* comments.rewrite(tx, canvas, (pinned) =>
      pinned.some((c) => renamed.has(c.page) || leaving.has(c.page))
        ? pinned.flatMap((c): Comment[] => {
            if (leaving.has(c.page)) {
              return [];
            }
            const moved = renamed.get(c.page);
            return [moved === undefined ? c : { ...c, page: moved }];
          })
        : pinned
    );
    yield* updateCanvas(tx, canvas, (layout) => ({
      ...layout,
      frames: Object.fromEntries(
        Object.entries(layout.frames).flatMap(([key, frame]) =>
          leaving.has(key) ? [] : [[renamed.get(key) ?? key, frame] as const]
        )
      ),
    }));
    // Only a base page serves a URL.
    if (moves.some((m) => m.page.variant === undefined && !m.page.state)) {
      yield* updateRoutes(tx, all, canvas, (routes) =>
        Object.fromEntries(
          Object.entries(routes).flatMap(([key, route]) =>
            leaving.has(key) ? [] : [[renamed.get(key) ?? key, route] as const]
          )
        )
      );
    }
    // Links name a page by its file: they follow it to its new one.
    if (renamed.size > 0) {
      yield* rewriteLinks(tx, canvas, (link) => renamed.get(link));
    }
    return before;
  });

  /** The pages moved (`to`) or gone (`to` null), each taking every follower along. */
  const movePages = Effect.fnUntraced(function* (
    tx: EditTransaction,
    all: PageList,
    moves: readonly PageMove[]
  ) {
    const sources = [...new Set(moves.map((m) => m.page.canvas))];
    // Each canvas as it was, for the frames that go elsewhere.
    const layouts = new Map<string, CanvasLayout>();
    for (const canvas of sources) {
      layouts.set(canvas, yield* canvasIn(tx, canvas));
    }
    // A move is the old file gone and the new one there, which is also how it is undone.
    for (const { page, to } of moves) {
      if (to === null) {
        yield* tx.remove(page.file);
      } else {
        const abs = yield* paths.resolve(path.join(root, to.canvas, to.path));
        yield* failIfExists(abs);
        yield* tx.move(page.file, paths.relative(abs));
      }
    }
    const carried: Comment[] = [];
    for (const canvas of sources) {
      const here = moves.filter((m) => m.page.canvas === canvas);
      const before = yield* leave(tx, all, canvas, here);
      const away = new Map(
        here.flatMap(({ page, to }) =>
          to && to.canvas !== canvas ? [[page.path, to.path] as const] : []
        )
      );
      carried.push(
        ...before.flatMap((c) => {
          const at = away.get(c.page);
          return at === undefined ? [] : [{ ...c, page: at }];
        })
      );
    }
    const targets = [
      ...new Set(
        moves.flatMap(({ page, to }) =>
          to && to.canvas !== page.canvas ? [to.canvas] : []
        )
      ),
    ];
    for (const target of targets) {
      const arriving = moves.flatMap(({ page, to }) =>
        to?.canvas === target && page.canvas !== target
          ? [
              {
                frame: layouts.get(page.canvas)?.frames[page.path],
                page,
                path: to.path,
              },
            ]
          : []
      );
      yield* arriveIn(tx, all, target, arriving);
      // The conversation about a page goes where the page goes.
      const theirs = carried.filter((c) =>
        arriving.some((a) => a.path === c.page)
      );
      if (theirs.length > 0) {
        yield* comments.rewrite(tx, target, (there) => [...there, ...theirs]);
      }
    }
    yield* rebindIn(
      tx,
      new Map(
        moves.map(
          ({ page, to }) =>
            [page.id, to === null ? null : idOf(to.canvas, to.path)] as const
        )
      )
    );
  });

  return { arriveIn, movePages, rewriteLinks };
};
