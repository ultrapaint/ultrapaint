import type {
  CanvasLayout,
  FrameLayout,
  InspectResult,
  Rect,
  Screen,
  SourceLocation,
  TreeNode,
  ViewportPreset,
} from "@ultrapaint/contracts";
import { presetSize } from "@ultrapaint/contracts";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError, useProject } from "./project.ts";

export type Mode = "select" | "interact" | "pan";

export interface Selection {
  screenId: string;
  nodeId: string;
  source: SourceLocation | null;
}

interface EditorStore {
  flow: string | null;
  layout: CanvasLayout;
  /** Screens of the current flow that have no saved frame yet get a computed one. */
  frames: Record<string, FrameLayout>;
  view: { x: number; y: number; zoom: number };
  mode: Mode;
  selection: Selection | null;
  hover: { screenId: string; nodeId: string } | null;
  trees: Record<string, TreeNode>;
  rects: Record<string, Record<string, Rect>>;
  inspect: InspectResult | null;
  tokens: Record<string, string>;
  hostErrors: Record<string, string | null>;
  activeScreen: string | null;
  leftTab: "layers" | "screens" | "palette" | "changes";
  rightTab: "design" | "agents";

  openFlow: (flow: string) => Promise<void>;
  setView: (view: Partial<EditorStore["view"]>) => void;
  setMode: (mode: Mode) => void;
  setFrame: (screenId: string, frame: FrameLayout, persist?: boolean) => void;
  setPreset: (screenId: string, preset: ViewportPreset) => void;
  select: (selection: Selection | null) => void;
  setHover: (hover: EditorStore["hover"]) => void;
  setTree: (screenId: string, tree: TreeNode) => void;
  setRects: (screenId: string, rects: Record<string, Rect>) => void;
  setInspect: (inspect: InspectResult | null) => void;
  setTokens: (tokens: Record<string, string>) => void;
  setHostError: (screenId: string, error: string | null) => void;
  setActiveScreen: (screenId: string | null) => void;
  setLeftTab: (tab: EditorStore["leftTab"]) => void;
  setRightTab: (tab: EditorStore["rightTab"]) => void;
  zoomToFit: (viewport: { width: number; height: number }) => void;
  zoomToSelection: (viewport: { width: number; height: number }) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

const computeFrames = (
  screens: readonly Screen[],
  layout: CanvasLayout,
): Record<string, FrameLayout> => {
  const frames: Record<string, FrameLayout> = {};
  let cursorX = 0;
  for (const s of screens) {
    const key = s.id.split("/").pop() as string;
    const saved = layout.frames[key];
    if (saved) {
      frames[s.id] = saved;
      cursorX = Math.max(cursorX, saved.x + saved.width + 120);
    }
  }
  for (const s of screens) {
    if (frames[s.id]) continue;
    const size = presetSize.desktop;
    frames[s.id] = { x: cursorX, y: 0, width: size.width, height: size.height, preset: "desktop" };
    cursorX += size.width + 120;
  }
  return frames;
};

export const useEditor = create<EditorStore>((set, get) => ({
  flow: null,
  layout: { version: 1, frames: {} },
  frames: {},
  view: { x: 80, y: 80, zoom: 0.5 },
  mode: "select",
  selection: null,
  hover: null,
  trees: {},
  rects: {},
  inspect: null,
  tokens: {},
  hostErrors: {},
  activeScreen: null,
  leftTab: "layers",
  rightTab: "design",

  openFlow: async (flow) => {
    try {
      const layout = await api().request("canvas.get", { flow });
      const screens = useProject.getState().screens.filter((s) => s.flow === flow);
      const frames = computeFrames(screens, layout);
      set({
        flow,
        layout,
        frames,
        selection: null,
        hover: null,
        inspect: null,
        trees: {},
        rects: {},
        activeScreen: screens[0]?.id ?? null,
      });
      localStorage.setItem("ultrapaint:flow", flow);
    } catch (error) {
      reportError(error);
    }
  },
  setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),
  setMode: (mode) => set({ mode }),
  setFrame: (screenId, frame, persist = true) => {
    set((s) => ({ frames: { ...s.frames, [screenId]: frame } }));
    if (!persist) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const { flow, frames } = get();
      if (flow === null) return;
      const layoutFrames: Record<string, FrameLayout> = {};
      for (const [id, f] of Object.entries(frames)) layoutFrames[id.split("/").pop() as string] = f;
      const layout: CanvasLayout = { version: 1, frames: layoutFrames };
      set({ layout });
      api().request("canvas.set", { flow, layout }).catch(reportError);
    }, 400);
  },
  setPreset: (screenId, preset) => {
    const f = get().frames[screenId];
    if (!f) return;
    const size = preset === "custom" ? { width: f.width, height: f.height } : presetSize[preset];
    get().setFrame(screenId, { ...f, ...size, preset });
  },
  select: (selection) =>
    set({
      selection,
      inspect: selection ? get().inspect : null,
      activeScreen: selection?.screenId ?? get().activeScreen,
      rightTab: selection ? "design" : get().rightTab,
    }),
  setHover: (hover) => set({ hover }),
  setTree: (screenId, tree) => set((s) => ({ trees: { ...s.trees, [screenId]: tree } })),
  setRects: (screenId, rects) => set((s) => ({ rects: { ...s.rects, [screenId]: rects } })),
  setInspect: (inspect) => set({ inspect }),
  setTokens: (tokens) => set({ tokens }),
  setHostError: (screenId, error) =>
    set((s) => ({ hostErrors: { ...s.hostErrors, [screenId]: error } })),
  setActiveScreen: (activeScreen) => set({ activeScreen }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  zoomToFit: (viewport) => {
    const frames = Object.values(get().frames);
    if (frames.length === 0) return;
    fitTo(set, viewport, frames);
  },
  zoomToSelection: (viewport) => {
    const { selection, frames, rects } = get();
    if (!selection) return;
    const frame = frames[selection.screenId];
    const rect = rects[selection.screenId]?.[selection.nodeId];
    if (!frame) return;
    const target = rect
      ? { x: frame.x + rect.x, y: frame.y + rect.y, width: rect.width, height: rect.height }
      : frame;
    fitTo(set, viewport, [target]);
  },
}));

const fitTo = (
  set: (partial: Partial<EditorStore>) => void,
  viewport: { width: number; height: number },
  boxes: { x: number; y: number; width: number; height: number }[],
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
      Math.min((viewport.width - pad * 2) / (x2 - x1), (viewport.height - pad * 2) / (y2 - y1)),
    ),
  );
  set({
    view: {
      zoom,
      x: (viewport.width - (x2 - x1) * zoom) / 2 - x1 * zoom,
      y: (viewport.height - (y2 - y1) * zoom) / 2 - y1 * zoom,
    },
  });
};

/** Finds a node by id in a tree, returning the path of ancestors. */
export const findPath = (tree: TreeNode | undefined, id: string): TreeNode[] | null => {
  if (!tree) return null;
  const walk = (node: TreeNode, path: TreeNode[]): TreeNode[] | null => {
    const next = [...path, node];
    if (node.id === id) return next;
    for (const c of node.children) {
      const r = walk(c, next);
      if (r) return r;
    }
    return null;
  };
  return walk(tree, []);
};

export const findBySource = (
  tree: TreeNode | undefined,
  source: SourceLocation,
  preferKind?: TreeNode["kind"],
): TreeNode | null => {
  if (!tree) return null;
  let fallback: TreeNode | null = null;
  const walk = (node: TreeNode): TreeNode | null => {
    if (
      node.source &&
      node.source.file === source.file &&
      node.source.line === source.line &&
      node.source.col === source.col
    ) {
      if (!preferKind || node.kind === preferKind) return node;
      fallback ??= node;
    }
    for (const c of node.children) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(tree) ?? fallback;
};
