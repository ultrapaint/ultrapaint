import type { SourceLocation } from "@ultrapaint/contracts/base";
import type {
  InspectResult,
  Rect,
  TreeNode,
} from "@ultrapaint/contracts/preview";
import type {
  CanvasLayout,
  FrameLayout,
  Screen,
  ViewportPreset,
} from "@ultrapaint/contracts/screens";
import { presetSize } from "@ultrapaint/contracts/screens";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError, useProject } from "./project.ts";

export type Mode = "select" | "interact" | "pan";

/** What the app is for right now: prompting an agent, editing the design, or clicking through it. */
export type Workspace = "vibe" | "design" | "prototype";

/** Switcher order, which is also the order Ctrl+1..3 follow. */
export const workspaceOrder: readonly Workspace[] = [
  "vibe",
  "design",
  "prototype",
];

export type LeftTab = "chat" | "layers" | "screens" | "palette" | "changes";

/** Left panels each workspace offers, in rail order. The first is where a switch lands. */
export const workspaceTabs: Record<Workspace, readonly LeftTab[]> = {
  design: ["layers", "palette", "screens", "changes"],
  prototype: ["chat", "screens", "changes"],
  vibe: ["chat", "screens", "changes"],
};

export interface Selection {
  nodeId: string;
  screenId: string;
  source: SourceLocation | null;
}

interface EditorStore {
  activeScreen: string | null;
  flow: string | null;
  /** Screens of the current flow that have no saved frame yet get a computed one. */
  frames: Record<string, FrameLayout>;
  hostErrors: Record<string, string | null>;
  hover: { screenId: string; nodeId: string } | null;
  inspect: InspectResult | null;
  layout: CanvasLayout;
  leftTab: LeftTab;
  mode: Mode;

  openFlow: (flow: string) => Promise<void>;
  rects: Record<string, Record<string, Rect>>;
  select: (selection: Selection | null) => void;
  /** Screen selected as a whole (its frame), as opposed to an element inside it. */
  selectedScreen: string | null;
  selection: Selection | null;
  selectScreen: (screenId: string | null) => void;
  setActiveScreen: (screenId: string | null) => void;
  setFrame: (screenId: string, frame: FrameLayout, persist?: boolean) => void;
  setHostError: (screenId: string, error: string | null) => void;
  setHover: (hover: EditorStore["hover"]) => void;
  setInspect: (inspect: InspectResult | null) => void;
  setLeftTab: (tab: EditorStore["leftTab"]) => void;
  setMode: (mode: Mode) => void;
  setPreset: (screenId: string, preset: ViewportPreset) => void;
  setRects: (screenId: string, rects: Record<string, Rect>) => void;
  setSpacePan: (spacePan: boolean) => void;
  setTokens: (tokens: Record<string, string>) => void;
  setTree: (screenId: string, tree: TreeNode) => void;
  setView: (view: Partial<EditorStore["view"]>) => void;
  setWorkspace: (workspace: Workspace) => void;
  /** Space is held: the canvas pans whatever the current mode. */
  spacePan: boolean;
  tokens: Record<string, string>;
  trees: Record<string, TreeNode>;
  view: { x: number; y: number; zoom: number };
  workspace: Workspace;
  zoomToFit: (viewport: { width: number; height: number }) => void;
  zoomToSelection: (viewport: { width: number; height: number }) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

const computeFrames = (
  screens: readonly Screen[],
  layout: CanvasLayout
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
    if (frames[s.id]) {
      continue;
    }
    const size = presetSize.desktop;
    frames[s.id] = {
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

export const useEditor = create<EditorStore>((set, get) => ({
  activeScreen: null,
  flow: null,
  frames: {},
  hostErrors: {},
  hover: null,
  inspect: null,
  layout: { frames: {}, version: 1 },
  leftTab: "chat",
  mode: "select",

  openFlow: async (flow) => {
    try {
      const layout = await api().request("canvas.get", { flow });
      const screens = useProject
        .getState()
        .screens.filter((s) => s.flow === flow);
      const frames = computeFrames(screens, layout);
      set({
        activeScreen: screens[0]?.id ?? null,
        flow,
        frames,
        hover: null,
        inspect: null,
        layout,
        rects: {},
        selectedScreen: null,
        selection: null,
        trees: {},
      });
      localStorage.setItem("ultrapaint:flow", flow);
    } catch (error) {
      reportError(error);
    }
  },
  rects: {},
  select: (selection) =>
    set({
      activeScreen: selection?.screenId ?? get().activeScreen,
      inspect: selection ? get().inspect : null,
      selectedScreen: null,
      selection,
    }),
  selectedScreen: null,
  selection: null,
  selectScreen: (screenId) =>
    set({
      activeScreen: screenId ?? get().activeScreen,
      inspect: null,
      selectedScreen: screenId,
      selection: null,
    }),
  setActiveScreen: (activeScreen) => set({ activeScreen }),
  setFrame: (screenId, frame, persist = true) => {
    set((s) => ({ frames: { ...s.frames, [screenId]: frame } }));
    if (!persist) {
      return;
    }
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      const { flow, frames } = get();
      if (flow === null) {
        return;
      }
      const layoutFrames: Record<string, FrameLayout> = {};
      for (const [id, f] of Object.entries(frames)) {
        layoutFrames[id.split("/").pop() as string] = f;
      }
      const layout: CanvasLayout = { frames: layoutFrames, version: 1 };
      set({ layout });
      api().request("canvas.set", { flow, layout }).catch(reportError);
    }, 400);
  },
  setHostError: (screenId, error) =>
    set((s) => ({ hostErrors: { ...s.hostErrors, [screenId]: error } })),
  setHover: (hover) => set({ hover }),
  setInspect: (inspect) => set({ inspect }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setMode: (mode) => set({ mode }),
  setPreset: (screenId, preset) => {
    const f = get().frames[screenId];
    if (!f) {
      return;
    }
    const size =
      preset === "custom"
        ? { height: f.height, width: f.width }
        : presetSize[preset];
    get().setFrame(screenId, { ...f, ...size, preset });
  },
  setRects: (screenId, rects) =>
    set((s) => ({ rects: { ...s.rects, [screenId]: rects } })),
  setSpacePan: (spacePan) => set({ spacePan }),
  setTokens: (tokens) => set({ tokens }),
  setTree: (screenId, tree) =>
    set((s) => ({ trees: { ...s.trees, [screenId]: tree } })),
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
        inspect: null,
        selectedScreen: null,
        selection: null,
      }),
    });
  },
  spacePan: false,
  tokens: {},
  trees: {},
  view: { x: 80, y: 80, zoom: 0.5 },
  workspace: "vibe",
  zoomToFit: (viewport) => {
    const frames = Object.values(get().frames);
    if (frames.length === 0) {
      return;
    }
    fitTo(set, viewport, frames);
  },
  zoomToSelection: (viewport) => {
    const { selection, selectedScreen, frames, rects } = get();
    const screenFrame = selectedScreen ? frames[selectedScreen] : undefined;
    if (screenFrame) {
      fitTo(set, viewport, [screenFrame]);
      return;
    }
    if (!selection) {
      return;
    }
    const frame = frames[selection.screenId];
    const rect = rects[selection.screenId]?.[selection.nodeId];
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

const fitTo = (
  set: (partial: Partial<EditorStore>) => void,
  viewport: { width: number; height: number },
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
      x: (viewport.width - (x2 - x1) * zoom) / 2 - x1 * zoom,
      y: (viewport.height - (y2 - y1) * zoom) / 2 - y1 * zoom,
      zoom,
    },
  });
};

