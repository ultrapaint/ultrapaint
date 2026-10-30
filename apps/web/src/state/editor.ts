import type { Box } from "@ultrapaint/contracts/canvas-layout";
import type {
  CanvasLayout,
  FrameLayout,
  Page,
} from "@ultrapaint/contracts/pages";
import type { Rect } from "@ultrapaint/contracts/preview";
import { create } from "zustand";
import { nodeIn, useDocuments } from "./documents.ts";
import { useProject } from "./project.ts";
import { readUrl, writeMode } from "./url.ts";
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
  | "layers"
  | "designSystem"
  | "library"
  | "changes";

/**
 * The workspace a reload or a shared link asks for, or the canvas. A link from before Vibe and
 * Design were one (`?mode=vibe`) opens the canvas.
 */
const workspaceInUrl = (): Workspace =>
  workspaceOrder.find((w) => w === readUrl().mode) ?? "design";

/**
 * The canvas's left panels, in rail order: the agents always first. The prototype has no rail:
 * its left panel is its pages and the URLs they serve.
 */
export const railTabs: readonly LeftTab[] = [
  "chat",
  "layers",
  "designSystem",
  "library",
  "changes",
];

/**
 * What the right panel shows: the selection's fields, the code it stands for, or the canvas's
 * comments.
 */
export type RightTab = "design" | "code" | "comments";

/**
 * A node of a design. `frame` is where it is shown: a page's id, or `node:<id>` for a node
 * placed on the canvas and everything inside it.
 */
export interface Selection {
  frame: string;
  nodeId: string;
}

interface EditorStore {
  /**
   * The page serving the current route, or the page without a URL the editor is on: what the
   * prototype shows and agents are about. Where the editor is (`activePage`, `canvas`, `route`,
   * `variant`) is written by `location.ts` alone.
   */
  activePage: string | null;
  /**
   * The other nodes selected with `selection`, in the same frame: Shift-click and the marquee add
   * them. `selection` is the one the inspector shows and the menus act on first.
   */
  also: readonly Selection[];
  canvas: string | null;
  /** Where the pages' frames are; pages with no saved frame yet get a computed one. */
  frames: Record<string, FrameLayout>;
  /**
   * Nodes on the canvas drawn where the pointer put them rather than where their document has
   * them: while one is resized, and once one is let go, until the document has it.
   */
  held: Record<string, Partial<Box>>;
  hover: Selection | null;
  layout: CanvasLayout;
  leftTab: LeftTab;
  /** What the workspaces not shown were left with: their tools, the canvas's selection. */
  memory: WorkspaceMemory;
  mode: Mode;
  rects: Record<string, Record<string, Rect>>;
  rightTab: RightTab;
  /**
   * Where the canvas's router is. The editor holds it; the preview is told. Null while the
   * editor is on a page that serves no URL.
   */
  route: string | null;
  /** Page selected as a whole (its frame), as opposed to a node inside it. */
  selectedPage: string | null;
  selection: Selection | null;
  setHover: (hover: EditorStore["hover"]) => void;
  setMode: (mode: Mode) => void;
  setRects: (frame: string, rects: Record<string, Rect>) => void;
  setRightTab: (tab: RightTab) => void;
  /** The drawn size of a node on the canvas, as its preview measured it. */
  setSize: (frame: string, size: { height: number; width: number }) => void;
  setSpacePan: (spacePan: boolean) => void;
  setWorkspace: (workspace: Workspace) => void;
  /** Measured sizes of the frames of nodes on the canvas. */
  sizes: Record<string, { height: number; width: number }>;
  /** Space is held: the canvas pans whatever the current mode. */
  spacePan: boolean;
  /** The variant the router is in: its pages serve their routes, the base's the rest. */
  variant: string | null;
  /** Where the canvas is looked at from; `camera.ts` alone moves it. */
  view: { x: number; y: number; zoom: number };
  workspace: Workspace;
}

/** What the editor's store holds, for the modules that write a part of it. */
export type EditorState = EditorStore;

export const pagesOfCanvas = (canvas: string | null): readonly Page[] =>
  canvas === null
    ? []
    : useProject.getState().pages.filter((p) => p.canvas === canvas);

/** Whether two reports of a frame's rects hold the same rects for the same nodes. */
const sameRects = (
  a: Readonly<Record<string, Rect>> | undefined,
  b: Readonly<Record<string, Rect>>
) => {
  if (!a) {
    return false;
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const was = a[key] as Rect;
      const is = b[key];
      return (
        is !== undefined &&
        was.x === is.x &&
        was.y === is.y &&
        was.width === is.width &&
        was.height === is.height
      );
    })
  );
};

/**
 * The frames of the board view open in the page canvas's place (ADR 0045), as `board.ts` says
 * them; null on the page canvas. Told here rather than read, as the board's module leans on this
 * one.
 */
let boardFrames: () => Readonly<Record<string, Box>> | null = () => null;

/** The board view's frames while one is open; null on the page canvas. */
export const boardFramesNow = () => boardFrames();

/** `board.ts` says where the frames of the board view open are, until the editor stops. */
export const showBoardFramesWith = (
  frames: () => Readonly<Record<string, Box>> | null
) => {
  boardFrames = frames;
};

/** Whether a board view is open in the page canvas's place: no node of a page is seen there. */
export const onBoard = () => boardFrames() !== null;

/**
 * Whether a board's frame takes a selection: one an app component's tree is edited in place on
 * (ADR 0045), as `board.ts` says it.
 */
let boardTakesSelection: (frame: string) => boolean = () => false;

/** `board.ts` says which of its frames take a selection. */
export const takeBoardSelectionWith = (takes: (frame: string) => boolean) => {
  boardTakesSelection = takes;
};

/** Nothing selected, hovered or picked with it: where a navigation leaves the selection. */
export const unpicked = {
  also: [],
  hover: null,
  selectedPage: null,
  selection: null,
} satisfies Partial<EditorStore>;

export const useEditor = create<EditorStore>((set, get) => ({
  activePage: null,
  also: [],
  canvas: null,
  frames: {},
  held: {},
  hover: null,
  layout: { frames: {}, version: 1 },
  leftTab: "chat",
  memory: emptyMemory,
  mode: modeFor(workspaceInUrl(), undefined),
  rects: {},
  rightTab: "design",
  route: "/",
  selectedPage: null,
  selection: null,
  // The pointer reports the same node many times a second; only a change is news.
  setHover: (hover) =>
    set((s) =>
      s.hover?.frame === hover?.frame && s.hover?.nodeId === hover?.nodeId
        ? s
        : { hover }
    ),
  setMode: (mode) => set({ mode }),
  // A preview reports again whenever its page changes; only rects that moved are news.
  setRects: (frame, rects) =>
    set((s) =>
      sameRects(s.rects[frame], rects)
        ? s
        : { rects: { ...s.rects, [frame]: rects } }
    ),
  setRightTab: (rightTab) => set({ rightTab }),
  setSize: (frame, size) =>
    set((s) => {
      const known = s.sizes[frame];
      return known?.width === size.width && known.height === size.height
        ? s
        : { sizes: { ...s.sizes, [frame]: size } };
    }),
  setSpacePan: (spacePan) => set({ spacePan }),
  setWorkspace: (workspace) => {
    const s = get();
    if (workspace === s.workspace) {
      return;
    }
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
      memory: next.memory,
      mode: next.mode,
      workspace,
    });
  },
  sizes: {},
  spacePan: false,
  variant: null,
  view: { x: 80, y: 80, zoom: 0.5 },
  workspace: workspaceInUrl(),
}));

/**
 * Nothing shows a selection in the prototype, nor on a board view, which draws no page: nothing
 * may be selected there but in an app component's tree, on its board (`frame`).
 */
export const hidesSelection = (frame?: string) =>
  useEditor.getState().workspace === "prototype" ||
  (onBoard() && !(frame !== undefined && boardTakesSelection(frame)));
