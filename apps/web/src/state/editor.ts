import type {
  CanvasLayout,
  FrameLayout,
  Page,
  ViewportPreset,
} from "@ultrapaint/contracts/pages";
import { presetSize } from "@ultrapaint/contracts/pages";
import type { Rect } from "@ultrapaint/contracts/preview";
import {
  basePathOf,
  matchRoute,
  normaliseRoute,
  pagesInVariant,
} from "@ultrapaint/shared/route";
import { create } from "zustand";
import { sizeForPreset } from "../lib/presets.ts";
import { api } from "./connection.ts";
import {
  canvasNodes,
  isNodeFrame,
  nodeFrameOf,
  nodeIn,
  useDocuments,
} from "./documents.ts";
import { reportError, useProject } from "./project.ts";
import { viewedSnapshot } from "./snapshot-view.ts";
import { readUrl, writeMode, writeUrl } from "./url.ts";
import {
  emptyMemory,
  modeFor,
  switchWorkspace,
  type WorkspaceMemory,
} from "./workspace-memory.ts";

export type Mode = "select" | "group" | "text" | "interact" | "pan" | "comment";

/**
 * What the app is for right now: working on the canvas, with an agent and the inspector, or
 * clicking through the design as a prototype.
 */
export type Workspace = "design" | "prototype";

/** The order Ctrl+1..2 follow. */
export const workspaceOrder: readonly Workspace[] = ["design", "prototype"];

export type LeftTab =
  | "chat"
  | "comments"
  | "layers"
  | "pages"
  | "assets"
  | "designSystem"
  | "changes";

/**
 * The workspace a reload or a shared link asks for, or the canvas. A link from before Vibe and
 * Design were one (`?mode=vibe`) opens the canvas.
 */
const workspaceInUrl = (): Workspace =>
  workspaceOrder.find((w) => w === readUrl().mode) ?? "design";

/**
 * The left panels a workspace offers, in rail order: the agents always first. The pages and the
 * URLs they serve are the prototype's business; the canvas shows the pages, and its layers and
 * assets mean nothing in the prototype.
 */
export const railTabs: Record<Workspace, readonly LeftTab[]> = {
  design: ["chat", "layers", "assets", "designSystem", "comments", "changes"],
  prototype: ["chat", "pages", "designSystem", "comments", "changes"],
};

/**
 * Where to open a canvas: at a URL of its router, or on a page (its id) that serves none, in a
 * variant. Left out, the canvas opens on its home.
 */
export interface OpenAt {
  page?: string | null;
  route?: string | null;
  variant?: string | null;
}

/** What the right panel shows about the selection: its fields, or the code it stands for. */
export type RightTab = "design" | "code";

/**
 * A node of a design. `frame` is where it is shown: a page's id, or `node:<id>` for a node
 * placed on the canvas and everything inside it.
 */
export interface Selection {
  frame: string;
  nodeId: string;
}

/**
 * The part of the canvas nothing covers, in the canvas's own coordinates: `x` is where it begins,
 * past the left panel floating over the canvas's left edge.
 */
export interface Viewport {
  height: number;
  width: number;
  x: number;
}

interface EditorStore {
  /**
   * The page serving the current route, or the page without a URL the editor was opened on:
   * what the prototype shows and agents are about.
   */
  activePage: string | null;
  /**
   * The other nodes selected with `selection`, in the same frame: Shift-click and the marquee add
   * them. `selection` is the one the inspector shows and the menus act on first.
   */
  also: readonly Selection[];
  /**
   * Follows the layout as saved: an undo, an agent, a branch switch. Frames the editor is still
   * about to save are its own and stay.
   */
  applyLayout: (canvas: string, layout: CanvasLayout) => void;
  canvas: string | null;
  /** Where the pages' frames are; pages with no saved frame yet get a computed one. */
  frames: Record<string, FrameLayout>;
  /**
   * Nodes on the canvas drawn where the pointer put them rather than where their document has
   * them: while one is resized, and once one is let go, until the document has it.
   */
  held: Record<string, Partial<Box>>;
  hostErrors: Record<string, string | null>;
  hover: Selection | null;
  layout: CanvasLayout;
  leftTab: LeftTab;
  /** What the workspaces not shown were left with: their tools, the canvas's selection. */
  memory: WorkspaceMemory;
  mode: Mode;
  /** Goes to a route of the open canvas. Every navigation is an entry in the editor's history. */
  navigate: (route: string, options?: { push?: boolean }) => void;
  openCanvas: (canvas: string, at?: OpenAt) => Promise<void>;
  /**
   * Goes to a page of the open canvas: to its URL when it has one, which is a navigation like any
   * other, or to the page itself, which no link could have led to.
   */
  openPage: (pageId: string, options?: { push?: boolean }) => void;
  rects: Record<string, Record<string, Rect>>;
  rightTab: RightTab;
  /**
   * Where the canvas's router is. The editor holds it; the preview is told. Null while the
   * editor is on a page that serves no URL.
   */
  route: string | null;
  select: (selection: Selection | null) => void;
  /** Page selected as a whole (its frame), as opposed to a node inside it. */
  selectedPage: string | null;
  selection: Selection | null;
  /** Several nodes of one frame at once, the first of them the one the inspector shows. */
  selectMany: (selections: readonly Selection[]) => void;
  selectPage: (pageId: string | null) => void;
  setFrame: (pageId: string, frame: FrameLayout, persist?: boolean) => void;
  setHostError: (frame: string, error: string | null) => void;
  setHover: (hover: EditorStore["hover"]) => void;
  setLeftTab: (tab: EditorStore["leftTab"]) => void;
  setMode: (mode: Mode) => void;
  setPreset: (pageId: string, preset: ViewportPreset) => void;
  setRects: (frame: string, rects: Record<string, Rect>) => void;
  setRightTab: (tab: RightTab) => void;
  /** The drawn size of a node on the canvas, as its preview measured it. */
  setSize: (frame: string, size: { height: number; width: number }) => void;
  setSpacePan: (spacePan: boolean) => void;
  /** The variant the router serves its routes in; `null` is the base. A navigation of its own. */
  setVariant: (variant: string | null) => void;
  setView: (view: Partial<EditorStore["view"]>) => void;
  setWorkspace: (workspace: Workspace) => void;
  /** Measured sizes of the frames of nodes on the canvas. */
  sizes: Record<string, { height: number; width: number }>;
  /** Space is held: the canvas pans whatever the current mode. */
  spacePan: boolean;
  /** Puts the page that serves the current route back in step with the page list. */
  syncActivePage: () => void;
  /** Adds a node to the selection, or takes it out when it is in it: Shift-click. */
  toggleSelected: (selection: Selection) => void;
  /** The variant the router is in: its pages serve their routes, the base's the rest. */
  variant: string | null;
  view: { x: number; y: number; zoom: number };
  workspace: Workspace;
  zoomToFit: (viewport: Viewport) => void;
  zoomToSelection: (viewport: Viewport) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Counts the canvases asked for: only the last one asked for is opened. */
let opening = 0;

/**
 * Where a canvas opens: the page without a URL it was asked for, as it is, or the page serving
 * the route. A canvas whose route has no page opens on whatever page it does have: one with a
 * URL first, as the prototype can go on from it.
 */
export const landingOf = (
  all: readonly Page[],
  served: readonly Page[],
  target: string,
  pageId: string | null
): { landing: string | null; shown: string | null } => {
  const asked = pageId === null ? undefined : all.find((p) => p.id === pageId);
  if (asked && asked.route === undefined) {
    return { landing: null, shown: asked.id };
  }
  const match = matchRoute(served, target);
  if (match) {
    return { landing: target, shown: match.entry.id };
  }
  const routed = served.find((p) => p.route !== undefined);
  if (routed?.route !== undefined) {
    return { landing: routed.route, shown: routed.id };
  }
  const [first] = served;
  return first
    ? { landing: null, shown: first.id }
    : { landing: target, shown: null };
};

export const pagesOfCanvas = (canvas: string | null): readonly Page[] =>
  canvas === null
    ? []
    : useProject.getState().pages.filter((p) => p.canvas === canvas);

/**
 * The page a route is served by in a variant, matched the way the preview's router matches it:
 * the variant's own page for the route when it has one, the base page otherwise.
 */
const pageAt = (
  canvas: string | null,
  route: string | null,
  variant: string | null
): Page | null =>
  route === null
    ? null
    : (matchRoute(pagesInVariant(pagesOfCanvas(canvas), variant), route)
        ?.entry ?? null);

/** Where a node placed on the canvas is drawn: its own position, its measured or fixed size. */
export const nodeFrameLayout = (
  node: {
    x?: number | undefined;
    y?: number | undefined;
    width?: unknown;
    height?: unknown;
  },
  size: { height: number; width: number } | undefined
): { height: number; width: number; x: number; y: number } => ({
  height: typeof node.height === "number" ? node.height : (size?.height ?? 40),
  width: typeof node.width === "number" ? node.width : (size?.width ?? 120),
  x: node.x ?? 0,
  y: node.y ?? 0,
});

/** A box on the canvas, in the canvas's own coordinates. */
export interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** Draws a node on the canvas at `box` whatever its document says; without one, as it says. */
export const hold = (frame: string, box: Partial<Box> | null) =>
  useEditor.setState((s) => {
    if (box) {
      return { held: { ...s.held, [frame]: box } };
    }
    if (!(frame in s.held)) {
      return s;
    }
    const { [frame]: _released, ...held } = s.held;
    return { held };
  });

/**
 * Keeps a node on the canvas at `box` while `commit` takes it to its document, then leaves it to
 * the document: drawn from the document alone, it would jump back to where it was for as long as
 * the server takes to answer. A commit that fails leaves it where the document still has it. A
 * later hold of the same node outlives this one.
 */
export const holdUntil = async <T>(
  frame: string,
  box: Partial<Box>,
  commit: () => Promise<T>
): Promise<T> => {
  const held = { ...box };
  hold(frame, held);
  try {
    return await commit();
  } finally {
    if (useEditor.getState().held[frame] === held) {
      hold(frame, null);
    }
  }
};

/** Every frame of the canvas, pages and nodes alike: what fits, zooms and drops look at. */
export const allFrames = (): Record<string, Box> => {
  const { frames, held, sizes, canvas } = useEditor.getState();
  const out: Record<string, Box> = { ...frames };
  for (const node of canvasNodes(useDocuments.getState().docs, canvas)) {
    const frame = nodeFrameOf(node.id);
    out[frame] = { ...nodeFrameLayout(node, sizes[frame]), ...held[frame] };
  }
  return out;
};

/** The pages' frames: where the layout has them, the rest in a row to the right of them. */
export const computeFrames = (
  pages: readonly Page[],
  layout: CanvasLayout
): Record<string, FrameLayout> => {
  const frames: Record<string, FrameLayout> = {};
  let cursorX = 0;
  for (const page of pages) {
    const saved = layout.frames[page.path];
    if (saved) {
      frames[page.id] = saved;
      cursorX = Math.max(cursorX, saved.x + saved.width + 120);
    }
  }
  for (const page of pages) {
    if (frames[page.id]) {
      continue;
    }
    const size = presetSize.desktop;
    frames[page.id] = {
      height: size.height,
      preset: "desktop",
      width: size.width,
      x: cursorX,
      y: 0,
    };
    cursorX += size.width + 120;
  }
  return frames;
};

/** Saves the frames as they are now: one undo step on the server. */
const saveLayout = (
  get: () => EditorStore,
  set: (p: Partial<EditorStore>) => void
): Promise<void> => {
  const { frames, layout, canvas } = get();
  // A snapshot's frames move on screen and nowhere else.
  if (canvas === null || viewedSnapshot()) {
    return Promise.resolve();
  }
  const pages = pagesOfCanvas(canvas);
  const layoutFrames: Record<string, FrameLayout> = {};
  for (const [id, f] of Object.entries(frames)) {
    const page = pages.find((p) => p.id === id);
    if (page) {
      layoutFrames[page.path] = f;
    }
  }
  set({ layout: { ...layout, frames: layoutFrames } });
  return api()
    .request("canvas.set", { canvas, frames: layoutFrames })
    .catch(reportError);
};

/** Saves the layout a moment after the last change, so a drag is one step and not fifty. */
const persistLayout = (
  get: () => EditorStore,
  set: (p: Partial<EditorStore>) => void
) => {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveLayout(get, set);
  }, 400);
};

/**
 * Saves at once what is waiting to be saved. An undo right after a move has to find the move
 * in the journal, not have it land after the undo.
 */
export const flushLayout = (): Promise<void> => {
  if (!persistTimer) {
    return Promise.resolve();
  }
  clearTimeout(persistTimer);
  persistTimer = null;
  return saveLayout(useEditor.getState, useEditor.setState);
};

export const useEditor = create<EditorStore>((set, get) => ({
  activePage: null,
  also: [],
  applyLayout: (canvas, layout) => {
    const s = get();
    if (canvas !== s.canvas || persistTimer || viewedSnapshot()) {
      return;
    }
    set({ frames: computeFrames(pagesOfCanvas(canvas), layout), layout });
  },
  canvas: null,
  frames: {},
  held: {},
  hostErrors: {},
  hover: null,
  layout: { frames: {}, version: 1 },
  leftTab: "chat",
  memory: emptyMemory,
  mode: modeFor(workspaceInUrl(), undefined),

  navigate: (route, options) => {
    const next = normaliseRoute(route);
    const { canvas, variant } = get();
    set({
      activePage: pageAt(canvas, next, variant)?.id ?? null,
      also: [],
      hover: null,
      route: next,
      selectedPage: null,
      selection: null,
    });
    writeUrl(
      { canvas, page: null, route: next, variant },
      options?.push ?? true
    );
  },

  openCanvas: async (canvas, at = {}) => {
    const { page, route, variant = null } = at;
    opening += 1;
    const asked = opening;
    // A move still waiting to be saved belongs to the canvas being left: it is saved now, while
    // the frames are still that canvas's.
    flushLayout();
    try {
      const snapshot = viewedSnapshot();
      const layout = snapshot
        ? (snapshot.layouts[canvas] ?? { frames: {}, version: 1 as const })
        : await api().request("canvas.get", { canvas });
      // Another canvas was asked for while this one's layout was on its way.
      if (asked !== opening) {
        return;
      }
      const all = useProject
        .getState()
        .pages.filter((p) => p.canvas === canvas);
      const info = useProject.getState().canvases.find((s) => s.id === canvas);
      // A variant the canvas no longer has is the base.
      const kept =
        variant !== null && info?.variants.includes(variant) ? variant : null;
      const { landing, shown } = landingOf(
        all,
        pagesInVariant(all, kept),
        normaliseRoute(route ?? info?.home ?? "/"),
        page ?? null
      );
      if (useDocuments.getState().canvas !== canvas) {
        useDocuments.getState().load(canvas);
      }
      const { memory } = get();
      set({
        activePage: shown,
        also: [],
        canvas,
        frames: computeFrames(all, layout),
        held: {},
        hover: null,
        layout,
        // What was put aside of another canvas is nothing this one has.
        memory:
          canvas === get().canvas ? memory : { ...memory, putAside: null },
        rects: {},
        route: landing,
        selectedPage: null,
        selection: null,
        sizes: {},
        variant: kept,
      });
      writeUrl(
        {
          canvas,
          page: landing === null ? shown : null,
          route: landing,
          variant: kept,
        },
        false
      );
      localStorage.setItem("ultrapaint:canvas", canvas);
    } catch (error) {
      reportError(error);
    }
  },
  openPage: (pageId, options) => {
    const { activePage, canvas, route, variant } = get();
    const page = pagesOfCanvas(canvas).find((p) => p.id === pageId);
    if (!page) {
      return;
    }
    const pageVariant = page.variant ?? null;
    if (page.route !== undefined) {
      if (variant !== pageVariant) {
        set({ variant: pageVariant });
      }
      // Already there: stay on the route, and on the parameters it was reached with.
      if (activePage !== page.id || route === null) {
        get().navigate(page.route, options);
      }
      return;
    }
    set({
      activePage: page.id,
      also: [],
      hover: null,
      route: null,
      selectedPage: null,
      selection: null,
      variant: pageVariant,
    });
    writeUrl(
      { canvas, page: page.id, route: null, variant: pageVariant },
      options?.push ?? true
    );
  },
  rects: {},
  rightTab: "design",
  route: "/",
  select: (selection) => {
    if (selection && hidesSelection(get)) {
      return;
    }
    set({ also: [], selectedPage: null, selection });
    if (selection) {
      followFrame(get, set, selection.frame);
    }
  },
  selectedPage: null,
  selection: null,
  selectMany: (selections) => {
    const [first, ...rest] = selections;
    if (!first || hidesSelection(get)) {
      get().select(null);
      return;
    }
    get().select(first);
    set({ also: rest.filter((s) => s.frame === first.frame) });
  },
  selectPage: (pageId) => {
    if (pageId && hidesSelection(get)) {
      return;
    }
    set({ also: [], selectedPage: pageId, selection: null });
    if (pageId) {
      followFrame(get, set, pageId);
    }
  },
  setFrame: (pageId, frame, persist = true) => {
    set((s) => ({ frames: { ...s.frames, [pageId]: frame } }));
    if (persist) {
      persistLayout(get, set);
    }
  },
  setHostError: (pageId, error) =>
    set((s) => ({ hostErrors: { ...s.hostErrors, [pageId]: error } })),
  // The pointer reports the same node many times a second; only a change is news.
  setHover: (hover) =>
    set((s) =>
      s.hover?.frame === hover?.frame && s.hover?.nodeId === hover?.nodeId
        ? s
        : { hover }
    ),
  setLeftTab: (leftTab) => set({ leftTab }),
  setMode: (mode) => set({ mode }),
  setPreset: (pageId, preset) => {
    const f = get().frames[pageId];
    if (!f) {
      return;
    }
    get().setFrame(pageId, { ...f, ...sizeForPreset(preset, f), preset });
  },
  setRects: (frame, rects) =>
    set((s) => ({ rects: { ...s.rects, [frame]: rects } })),
  setRightTab: (rightTab) => set({ rightTab }),
  setSize: (frame, size) =>
    set((s) => {
      const known = s.sizes[frame];
      return known?.width === size.width && known.height === size.height
        ? s
        : { sizes: { ...s.sizes, [frame]: size } };
    }),
  setSpacePan: (spacePan) => set({ spacePan }),
  setVariant: (variant) => {
    const { activePage, canvas, route } = get();
    if (route === null) {
      // On a page without a URL: the same page, drawn for the variant when it is.
      const pages = pagesOfCanvas(canvas);
      const base = basePathOf(
        pages.find((p) => p.id === activePage)?.path ?? ""
      );
      const own = pages.filter((p) => basePathOf(p.path) === base);
      const shown =
        own.find((p) => (p.variant ?? null) === variant) ??
        own.find((p) => p.variant === undefined);
      set({ activePage: shown?.id ?? activePage, variant });
      writeUrl(
        { canvas, page: shown?.id ?? activePage, route: null, variant },
        true
      );
      return;
    }
    set({ activePage: pageAt(canvas, route, variant)?.id ?? null, variant });
    writeUrl({ canvas, page: null, route, variant }, true);
  },
  setView: (view) => {
    // Said outright, it goes over whatever was waiting for the next frame.
    const base = nextView();
    cancelPendingView();
    set({ view: { ...base, ...view } });
  },
  setWorkspace: (workspace) => {
    const s = get();
    if (workspace === s.workspace) {
      return;
    }
    const kept = railTabs[workspace].includes(s.leftTab);
    const { docs } = useDocuments.getState();
    const pages = pagesOfCanvas(s.canvas);
    // Nothing shows the selection in the prototype, so no key may act on it there: it is put
    // aside, and found again on the canvas, less what was deleted meanwhile.
    const next = switchWorkspace(
      {
        mode: s.mode,
        picked: {
          also: s.also,
          selectedPage: s.selectedPage,
          selection: s.selection,
        },
        workspace: s.workspace,
      },
      workspace,
      s.memory,
      {
        node: (n) => nodeIn(docs, s.canvas, n.frame, n.nodeId) !== null,
        page: (id) => pages.some((p) => p.id === id),
      }
    );
    writeMode(workspace);
    set({
      ...next.picked,
      hover: null,
      leftTab: kept ? s.leftTab : "chat",
      memory: next.memory,
      mode: next.mode,
      workspace,
    });
  },
  sizes: {},
  spacePan: false,
  syncActivePage: () => {
    const { activePage, canvas, route, variant } = get();
    if (route === null) {
      const page = pagesOfCanvas(canvas).find((p) => p.id === activePage);
      if (page?.route !== undefined) {
        // The page was given a URL: the editor is at it now.
        set({ route: page.route });
        writeUrl({ canvas, page: null, route: page.route, variant }, false);
      } else if (!page) {
        set({ activePage: null });
      }
      return;
    }
    const id = pageAt(canvas, route, variant)?.id ?? null;
    if (id !== get().activePage) {
      set({ activePage: id });
    }
  },
  toggleSelected: (target) => {
    if (hidesSelection(get)) {
      return;
    }
    const { also, selection } = get();
    if (!selection || selection.frame !== target.frame) {
      get().select(target);
      return;
    }
    const same = (a: Selection) => a.nodeId === target.nodeId;
    if (same(selection)) {
      // The last one added before it takes its place.
      const next = also.at(-1) ?? null;
      set({ also: also.slice(0, -1), selection: next });
      return;
    }
    set({
      also: also.some(same)
        ? also.filter((a) => !same(a))
        : [...also, selection],
      selection: also.some(same) ? selection : target,
    });
  },
  variant: null,
  view: { x: 80, y: 80, zoom: 0.5 },
  workspace: workspaceInUrl(),
  zoomToFit: (viewport) => {
    const frames = Object.values(allFrames());
    if (frames.length === 0) {
      return;
    }
    fitTo(set, viewport, frames);
  },
  zoomToSelection: (viewport) => {
    const { selection, selectedPage, rects } = get();
    const frames = allFrames();
    const pageFrame = selectedPage ? frames[selectedPage] : undefined;
    if (pageFrame) {
      fitTo(set, viewport, [pageFrame]);
      return;
    }
    if (!selection) {
      return;
    }
    const frame = frames[selection.frame];
    const rect = rects[selection.frame]?.[selection.nodeId];
    if (!frame) {
      return;
    }
    const target = rect
      ? {
          height: rect.height,
          width: rect.width,
          x: frame.x + rect.x,
          y: frame.y + rect.y,
        }
      : frame;
    fitTo(set, viewport, [target]);
  },
}));

type View = EditorStore["view"];

/** Where the canvas is being panned or zoomed to, until the next frame draws it. */
let pendingView: View | null = null;
let viewFrame: number | null = null;

const cancelPendingView = () => {
  if (viewFrame !== null) {
    cancelAnimationFrame(viewFrame);
    viewFrame = null;
  }
  pendingView = null;
};

/** The view as the next frame will draw it: what a wheel or a drag goes on from. */
export const nextView = (): View => pendingView ?? useEditor.getState().view;

/**
 * Pans or zooms the canvas on the next frame. A wheel or a pointer reports many times a frame,
 * and the canvas is drawn once a frame: it takes them all in one change.
 */
export const setViewSoon = (view: Partial<View>) => {
  pendingView = { ...nextView(), ...view };
  viewFrame ??= requestAnimationFrame(() => {
    viewFrame = null;
    const next = pendingView;
    pendingView = null;
    if (next) {
      useEditor.setState({ view: next });
    }
  });
};

/** Nothing shows a selection in the prototype, so nothing may be selected there. */
const hidesSelection = (get: () => EditorStore) =>
  get().workspace === "prototype";

/**
 * Working inside a frame is being on its route, in its variant: the editor is only ever at one
 * place at a time, and the layers, the inspector and the prototype all read the route. It is not
 * a navigation the user asked for, so it replaces the history entry instead of adding one.
 */
const followFrame = (
  get: () => EditorStore,
  set: (partial: Partial<EditorStore>) => void,
  pageId: string
) => {
  if (isNodeFrame(pageId)) {
    return;
  }
  const { activePage, canvas, route, variant } = get();
  const page = pagesOfCanvas(canvas).find((p) => p.id === pageId);
  const pageVariant = page?.variant ?? null;
  if (!page) {
    return;
  }
  if (page.route === undefined) {
    if (activePage === page.id && route === null) {
      return;
    }
    set({ activePage: page.id, route: null, variant: pageVariant });
    writeUrl(
      { canvas, page: page.id, route: null, variant: pageVariant },
      false
    );
    return;
  }
  if (page.route === route && pageVariant === variant) {
    return;
  }
  set({ activePage: page.id, route: page.route, variant: pageVariant });
  writeUrl(
    { canvas, page: null, route: page.route, variant: pageVariant },
    false
  );
};

const fitTo = (
  set: (partial: Partial<EditorStore>) => void,
  viewport: Viewport,
  boxes: { x: number; y: number; width: number; height: number }[]
) => {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  const pad = 60;
  const zoom = Math.min(
    4,
    Math.max(
      0.05,
      Math.min(
        (viewport.width - pad * 2) / (x2 - x1),
        (viewport.height - pad * 2) / (y2 - y1)
      )
    )
  );
  // A fit takes the whole view: a pan or zoom still waiting for the next frame (a trackpad's
  // inertia) would otherwise land on top of it.
  cancelPendingView();
  set({
    view: {
      x: viewport.x + (viewport.width - (x2 - x1) * zoom) / 2 - x1 * zoom,
      y: (viewport.height - (y2 - y1) * zoom) / 2 - y1 * zoom,
      zoom,
    },
  });
};

/**
 * Selects a node for a right-click. One that is already selected keeps the selection as it is:
 * the menu then acts on all of it, as a menu does in Figma.
 */
export const selectForMenu = (target: Selection) => {
  const { also, select, selection } = useEditor.getState();
  const same = (s: Selection) =>
    s.frame === target.frame && s.nodeId === target.nodeId;
  if (selection && (same(selection) || also.some(same))) {
    return;
  }
  select(target);
};
