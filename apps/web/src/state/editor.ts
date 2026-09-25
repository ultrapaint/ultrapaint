import type {
  CanvasLayout,
  FrameLayout,
  Page,
  ViewportPreset,
} from "@ultrapaint/contracts/pages";
import { presetSize } from "@ultrapaint/contracts/pages";
import type { Rect } from "@ultrapaint/contracts/preview";
import { matchRoute, normaliseRoute } from "@ultrapaint/shared/route";
import { create } from "zustand";
import { api } from "./connection.ts";
import {
  canvasNodes,
  isNodeFrame,
  nodeFrameOf,
  useDocuments,
} from "./documents.ts";
import { reportError, useProject } from "./project.ts";
import { writeUrl } from "./url.ts";

export type Mode = "select" | "interact" | "pan" | "comment";

/** What the app is for right now: prompting an agent, editing the design, or clicking through it. */
export type Workspace = "vibe" | "design" | "prototype";

/** Switcher order, which is also the order Ctrl+1..3 follow. */
export const workspaceOrder: readonly Workspace[] = [
  "vibe",
  "design",
  "prototype",
];

export type LeftTab =
  | "chat"
  | "comments"
  | "layers"
  | "pages"
  | "palette"
  | "designSystem"
  | "changes";

/** Left panels each workspace offers, in rail order. The first is where a switch lands. */
export const workspaceTabs: Record<Workspace, readonly LeftTab[]> = {
  design: ["layers", "palette", "designSystem", "pages", "comments", "changes"],
  prototype: ["pages", "chat", "changes"],
  vibe: ["chat", "pages", "designSystem", "comments", "changes"],
};

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
  /** The page serving the current route, which is what the prototype and agents are about. */
  activePage: string | null;
  /**
   * Follows the layout as saved: an undo, an agent, a branch switch. Frames the editor is still
   * about to save are its own and stay.
   */
  applyLayout: (space: string, layout: CanvasLayout) => void;
  /** Where the pages' frames are; pages with no saved frame yet get a computed one. */
  frames: Record<string, FrameLayout>;
  hostErrors: Record<string, string | null>;
  hover: Selection | null;
  layout: CanvasLayout;
  leftTab: LeftTab;
  mode: Mode;
  /** Goes to a route of the open space. Every navigation is an entry in the editor's history. */
  navigate: (route: string, options?: { push?: boolean }) => void;
  openSpace: (space: string, route?: string) => Promise<void>;
  rects: Record<string, Record<string, Rect>>;
  /** Where the space's router is. The editor holds it; the preview is told. */
  route: string;
  select: (selection: Selection | null) => void;
  /** Page selected as a whole (its frame), as opposed to a node inside it. */
  selectedPage: string | null;
  selection: Selection | null;
  selectPage: (pageId: string | null) => void;
  setFrame: (pageId: string, frame: FrameLayout, persist?: boolean) => void;
  setHostError: (frame: string, error: string | null) => void;
  setHover: (hover: EditorStore["hover"]) => void;
  setLeftTab: (tab: EditorStore["leftTab"]) => void;
  setMode: (mode: Mode) => void;
  setPreset: (pageId: string, preset: ViewportPreset) => void;
  setRects: (frame: string, rects: Record<string, Rect>) => void;
  /** The drawn size of a node on the canvas, as its preview measured it. */
  setSize: (frame: string, size: { height: number; width: number }) => void;
  setSpacePan: (spacePan: boolean) => void;
  setView: (view: Partial<EditorStore["view"]>) => void;
  setWorkspace: (workspace: Workspace) => void;
  /** Measured sizes of the frames of nodes on the canvas. */
  sizes: Record<string, { height: number; width: number }>;
  space: string | null;
  /** Space is held: the canvas pans whatever the current mode. */
  spacePan: boolean;
  /** Puts the page that serves the current route back in step with the page list. */
  syncActivePage: () => void;
  view: { x: number; y: number; zoom: number };
  workspace: Workspace;
  zoomToFit: (viewport: Viewport) => void;
  zoomToSelection: (viewport: Viewport) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const pagesOfSpace = (space: string | null): readonly Page[] =>
  space === null
    ? []
    : useProject.getState().pages.filter((p) => p.space === space);

/** The page a route is served by, matched the way the preview's router matches it. */
const pageAt = (space: string | null, route: string): Page | null =>
  matchRoute(pagesOfSpace(space), route)?.entry ?? null;

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

/** Every frame of the canvas, pages and nodes alike: what fits, zooms and drops look at. */
export const allFrames = (): Record<
  string,
  { height: number; width: number; x: number; y: number }
> => {
  const { frames, sizes, space } = useEditor.getState();
  const out: Record<
    string,
    { height: number; width: number; x: number; y: number }
  > = {
    ...frames,
  };
  for (const node of canvasNodes(useDocuments.getState().docs, space)) {
    const frame = nodeFrameOf(node.id);
    out[frame] = nodeFrameLayout(node, sizes[frame]);
  }
  return out;
};

const computeFrames = (
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
  const { frames, layout, space } = get();
  if (space === null) {
    return Promise.resolve();
  }
  const pages = pagesOfSpace(space);
  const layoutFrames: Record<string, FrameLayout> = {};
  for (const [id, f] of Object.entries(frames)) {
    const page = pages.find((p) => p.id === id);
    if (page) {
      layoutFrames[page.path] = f;
    }
  }
  set({ layout: { ...layout, frames: layoutFrames } });
  return api()
    .request("canvas.set", { frames: layoutFrames, space })
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
  applyLayout: (space, layout) => {
    const s = get();
    if (space !== s.space || persistTimer) {
      return;
    }
    set({ frames: computeFrames(pagesOfSpace(space), layout), layout });
  },
  frames: {},
  hostErrors: {},
  hover: null,
  layout: { frames: {}, version: 1 },
  leftTab: "chat",
  mode: "select",

  navigate: (route, options) => {
    const next = normaliseRoute(route);
    const { space } = get();
    set({
      activePage: pageAt(space, next)?.id ?? null,
      hover: null,
      route: next,
      selectedPage: null,
      selection: null,
    });
    writeUrl({ route: next, space }, options?.push ?? true);
  },

  openSpace: async (space, route) => {
    try {
      const layout = await api().request("canvas.get", { space });
      const pages = useProject
        .getState()
        .pages.filter((p) => p.space === space);
      const home =
        useProject.getState().spaces.find((s) => s.id === space)?.home ?? "/";
      const target = normaliseRoute(route ?? home);
      // A space whose home route has no page opens on whatever page it does have.
      const landing =
        matchRoute(pages, target) === null
          ? (pages[0]?.route ?? target)
          : target;
      if (useDocuments.getState().space !== space) {
        useDocuments.getState().load(space);
      }
      set({
        activePage: matchRoute(pages, landing)?.entry.id ?? null,
        frames: computeFrames(pages, layout),
        hover: null,
        layout,
        rects: {},
        route: landing,
        selectedPage: null,
        selection: null,
        sizes: {},
        space,
      });
      writeUrl({ route: landing, space }, false);
      localStorage.setItem("ultrapaint:space", space);
    } catch (error) {
      reportError(error);
    }
  },
  rects: {},
  route: "/",
  select: (selection) => {
    set({ selectedPage: null, selection });
    if (selection) {
      followFrame(get, set, selection.frame);
    }
  },
  selectedPage: null,
  selection: null,
  selectPage: (pageId) => {
    set({ selectedPage: pageId, selection: null });
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
  setHover: (hover) => set({ hover }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setMode: (mode) => set({ mode }),
  setPreset: (pageId, preset) => {
    const f = get().frames[pageId];
    if (!f) {
      return;
    }
    const size =
      preset === "custom"
        ? { height: f.height, width: f.width }
        : presetSize[preset];
    get().setFrame(pageId, { ...f, ...size, preset });
  },
  setRects: (frame, rects) =>
    set((s) => ({ rects: { ...s.rects, [frame]: rects } })),
  setSize: (frame, size) =>
    set((s) => {
      const known = s.sizes[frame];
      return known?.width === size.width && known.height === size.height
        ? s
        : { sizes: { ...s.sizes, [frame]: size } };
    }),
  setSpacePan: (spacePan) => set({ spacePan }),
  setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),
  setWorkspace: (workspace) => {
    const tabs = workspaceTabs[workspace];
    const { leftTab } = get();
    set({
      leftTab: tabs.includes(leftTab) ? leftTab : (tabs[0] ?? "chat"),
      workspace,
      // Nothing shows the selection in the prototype, so no key may act on it there.
      ...(workspace === "prototype" && {
        hover: null,
        selectedPage: null,
        selection: null,
      }),
    });
  },
  sizes: {},
  space: null,
  spacePan: false,
  syncActivePage: () => {
    const { route, space } = get();
    const id = pageAt(space, route)?.id ?? null;
    if (id !== get().activePage) {
      set({ activePage: id });
    }
  },
  view: { x: 80, y: 80, zoom: 0.5 },
  workspace: "vibe",
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

/**
 * Working inside a frame is being on its route: the editor is only ever at one place at a time,
 * and the layers, the inspector and the prototype all read the route. It is not a navigation
 * the user asked for, so it replaces the history entry instead of adding one.
 */
const followFrame = (
  get: () => EditorStore,
  set: (partial: Partial<EditorStore>) => void,
  pageId: string
) => {
  if (isNodeFrame(pageId)) {
    return;
  }
  const { route, space } = get();
  const page = pagesOfSpace(space).find((p) => p.id === pageId);
  if (!page || page.route === route) {
    return;
  }
  set({ activePage: page.id, route: page.route });
  writeUrl({ route: page.route, space }, false);
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
  set({
    view: {
      x: viewport.x + (viewport.width - (x2 - x1) * zoom) / 2 - x1 * zoom,
      y: (viewport.height - (y2 - y1) * zoom) / 2 - y1 * zoom,
      zoom,
    },
  });
};
