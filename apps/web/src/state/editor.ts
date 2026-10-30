import {
  type Box,
  canvasFrames,
  placeView,
  viewIdFor,
} from "@ultrapaint/contracts/canvas-layout";
import type {
  CanvasLayout,
  FrameLayout,
  FrameView,
  Page,
  ViewportPreset,
} from "@ultrapaint/contracts/pages";
import type { Rect } from "@ultrapaint/contracts/preview";
import { create } from "zustand";
import { sizeForPreset } from "../lib/presets.ts";
import { api } from "./connection.ts";
import {
  canvasNodes,
  isViewFrame,
  nodeFrameOf,
  nodeIn,
  pageOfFrame,
  useDocuments,
  viewFrameOf,
  viewOfFrame,
} from "./documents.ts";
import { followFrame } from "./location.ts";
import { reportError, useProject } from "./project.ts";
import { isSelected, pickedIn, showsIn } from "./selection.ts";
import { follow } from "./server-data.ts";
import { viewedSnapshot } from "./snapshot-view.ts";
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
  /** Draws a page again at another width beside its frame; the new view's frame id. */
  addView: (pageId: string, width: number, height?: number) => string | null;
  /**
   * The other nodes selected with `selection`, in the same frame: Shift-click and the marquee add
   * them. `selection` is the one the inspector shows and the menus act on first.
   */
  also: readonly Selection[];
  /**
   * Follows the layout as saved: an undo, an agent, a branch switch. A page whose save the server
   * has not answered yet stays where the editor put it; the push after the answer brings it.
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
  hover: Selection | null;
  layout: CanvasLayout;
  leftTab: LeftTab;
  /** What the workspaces not shown were left with: their tools, the canvas's selection. */
  memory: WorkspaceMemory;
  mode: Mode;
  rects: Record<string, Record<string, Rect>>;
  /** Takes a view of a page away, by its frame id. */
  removeView: (frame: string) => void;
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
  /**
   * Sets a frame and saves it at once: a page's (its views move with it) or a view's, in its
   * page's frame (ADR 0036). A page's frame given without views keeps the ones it has. A frame
   * gesture shows the frame as it goes (`showFrame`) and sets it once when it is let go.
   */
  setFrame: (pageId: string, frame: FrameLayout) => void;
  setHover: (hover: EditorStore["hover"]) => void;
  setMode: (mode: Mode) => void;
  setPreset: (pageId: string, preset: ViewportPreset) => void;
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
  /** Adds a node to the selection, or takes it out when it is in it: Shift-click. */
  toggleSelected: (selection: Selection) => void;
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

export type { Box } from "@ultrapaint/contracts/canvas-layout";

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
 * Draws a frame at `frame` without saving it, as `setFrame` places it: a frame gesture's frame
 * while the pointer moves it, and where it was when the gesture is put back.
 */
export const showFrame = (pageId: string, frame: FrameLayout) =>
  useEditor.setState((s) => ({ frames: framesWith(s.frames, pageId, frame) }));

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

/**
 * The frames of the board view open in the page canvas's place (ADR 0045), as `board.ts` says
 * them; null on the page canvas. Told here rather than read, as the board's module leans on this
 * one.
 */
let boardFrames: () => Readonly<Record<string, Box>> | null = () => null;

/** `board.ts` says where the frames of the board view open are, until the editor stops. */
export const showBoardFramesWith = (
  frames: () => Readonly<Record<string, Box>> | null
) => {
  boardFrames = frames;
};

/** Whether a board view is open in the page canvas's place: no node of a page is seen there. */
export const onBoard = () => boardFrames() !== null;

/**
 * Every frame of the canvas, pages and nodes alike: what fits, zooms and drops look at. On a
 * board view, the boards' frames.
 */
export const allFrames = (): Record<string, Box> => {
  const board = boardFrames();
  if (board) {
    return { ...board };
  }
  const { frames, held, sizes, canvas } = useEditor.getState();
  const out: Record<string, Box> = { ...frames };
  for (const node of canvasNodes(useDocuments.getState().docs, canvas)) {
    const frame = nodeFrameOf(node.id);
    out[frame] = { ...nodeFrameLayout(node, sizes[frame]), ...held[frame] };
  }
  return out;
};

/**
 * The frames with their pages' views among them, each a box of its own where its page's frame
 * puts it (ADR 0036): a view's place is counted from its page's frame, so it moves with it.
 */
const placeViews = (
  frames: Record<string, FrameLayout>
): Record<string, FrameLayout> => {
  const out: Record<string, FrameLayout> = {};
  for (const [id, frame] of Object.entries(frames)) {
    if (isViewFrame(id)) {
      continue;
    }
    out[id] = frame;
    for (const view of frame.views ?? []) {
      out[viewFrameOf(id, view.id)] = {
        height: view.height,
        preset: "custom",
        width: view.width,
        x: frame.x + view.x,
        y: frame.y + view.y,
      };
    }
  }
  return out;
};

/** The frames once `id`, a page's frame or one of its views, is `box`. */
const framesWith = (
  frames: Record<string, FrameLayout>,
  id: string,
  box: FrameLayout
): Record<string, FrameLayout> => {
  const view = viewOfFrame(id);
  if (view === null) {
    // A frame given without its views keeps those it has.
    const views = "views" in box ? box.views : frames[id]?.views;
    return placeViews({
      ...frames,
      [id]: { ...box, ...(views && views.length > 0 ? { views } : {}) },
    });
  }
  const pageId = pageOfFrame(id);
  const page = frames[pageId];
  if (!page) {
    return frames;
  }
  const views = (page.views ?? []).map((v) =>
    v.id === view
      ? {
          height: box.height,
          id: v.id,
          width: box.width,
          x: box.x - page.x,
          y: box.y - page.y,
        }
      : v
  );
  return placeViews({ ...frames, [pageId]: { ...page, views } });
};

/** The pages' own frames, each with its views, without the views' own boxes. */
const pageFrames = (
  frames: Record<string, FrameLayout>
): Record<string, FrameLayout> =>
  Object.fromEntries(Object.entries(frames).filter(([id]) => !isViewFrame(id)));

/**
 * The pages' frames, by page id, where `canvas-layout` has the editor draw them: where the
 * layout has them, the rest in a row to the right of them.
 */
export const computeFrames = (
  pages: readonly Page[],
  layout: CanvasLayout
): Record<string, FrameLayout> => {
  const byPath = canvasFrames(
    pages.map((p) => p.path),
    layout.frames
  );
  const idOf = new Map(pages.map((p) => [p.path, p.id]));
  const frames: Record<string, FrameLayout> = {};
  for (const [path, frame] of Object.entries(byPath)) {
    frames[idOf.get(path) ?? path] = frame;
  }
  return placeViews(frames);
};

/** A save of a canvas's frames the server has not answered yet: the frames it sent, by path. */
interface Save {
  readonly canvas: string;
  readonly done: Promise<void>;
  readonly frames: Readonly<Record<string, FrameLayout>>;
}

const saving = new Set<Save>();

/**
 * `layout` with the frames whose saves are in flight as the editor sent them, the latest sent
 * of a page winning: what the server will have once it answers. The same layout when none are.
 */
const withSaving = (canvas: string, layout: CanvasLayout): CanvasLayout => {
  const sent = [...saving].filter((save) => save.canvas === canvas);
  return sent.length === 0
    ? layout
    : {
        ...layout,
        frames: Object.assign({}, layout.frames, ...sent.map((s) => s.frames)),
      };
};

/**
 * The page a frame gesture draws (moved or sized, a view of it included), and its frame as a
 * layout pushed meanwhile has it: the push leaves the page as the gesture draws it, as it does a
 * page whose save is in flight. The gesture's save, once let go, wins; the push after its answer
 * brings the page current.
 */
let gesture: { readonly page: string; pushed: FrameLayout | null } | null =
  null;

/** A frame gesture draws `frame` from now on, until `doneDrawingFrame`. */
export const drawingFrame = (frame: string) => {
  gesture = { page: pageOfFrame(frame), pushed: null };
};

/**
 * The frame gesture is over. Answers its page's frame as a layout pushed meanwhile has it, with
 * the page's id, for a gesture put back to show; null when none was pushed.
 */
export const doneDrawingFrame = (): {
  frame: FrameLayout;
  page: string;
} | null => {
  const done = gesture;
  gesture = null;
  return done?.pushed ? { frame: done.pushed, page: done.page } : null;
};

/** `frames` computed from a layout, with the page a gesture draws as `drawn` has it. */
const withGesture = (
  frames: Record<string, FrameLayout>,
  drawn: Record<string, FrameLayout>
): Record<string, FrameLayout> => {
  const shown = gesture ? drawn[gesture.page] : undefined;
  if (!(gesture && shown)) {
    return frames;
  }
  gesture.pushed = frames[gesture.page] ?? null;
  return framesWith(frames, gesture.page, shown);
};

/** A page's frame as the layout saves it: its views kept only when it has some. */
const savedFrame = ({ views, ...frame }: FrameLayout): FrameLayout =>
  views && views.length > 0 ? { ...frame, views } : frame;

/**
 * Saves `frame`'s page as it is drawn now, one undo step on the server, with the pages drawn
 * where no frame of theirs is saved: drawn after the saved ones, they would move with it.
 */
const saveFrame = (
  get: () => EditorStore,
  set: (p: Partial<EditorStore>) => void,
  frame: string
) => {
  const { frames, layout, canvas } = get();
  // A snapshot's frames move on screen and nowhere else.
  if (canvas === null || viewedSnapshot()) {
    return;
  }
  const changed = pageOfFrame(frame);
  const sent: Record<string, FrameLayout> = {};
  for (const page of pagesOfCanvas(canvas)) {
    const drawn = frames[page.id];
    if (drawn && (page.id === changed || !(page.path in layout.frames))) {
      sent[page.path] = savedFrame(drawn);
    }
  }
  if (Object.keys(sent).length === 0) {
    return;
  }
  set({ layout: { ...layout, frames: { ...layout.frames, ...sent } } });
  const save: Save = {
    canvas,
    done: api()
      .request("canvas.set", { canvas, frames: sent })
      .then(() => undefined, reportError)
      .finally(() => {
        saving.delete(save);
      }),
    frames: sent,
  };
  saving.add(save);
};

/**
 * Waits for the layout's saves in flight: an undo right after a move has to find the move in
 * the journal, not have it land after the undo.
 */
export const layoutSaved = async (): Promise<void> => {
  await Promise.all([...saving].map((save) => save.done));
};

/**
 * The layout of the canvas open, as saved: what an undo put back, what an agent or a branch
 * switch changed. A snapshot on screen shows the one it kept.
 */
const layoutData = follow({
  apply: (layout: CanvasLayout, canvas: string) =>
    useEditor.getState().applyLayout(canvas, layout),
  key: () => useEditor.getState().canvas,
  // Every canvas's layout is told; one told while a read is on its way waits for its answer.
  news: ["canvas"],
  on: {
    canvas: ({ canvas, layout }) =>
      useEditor.getState().applyLayout(canvas, layout),
  },
  read: (canvas) => api().request("canvas.get", { canvas }),
  snapshot: (view, canvas): CanvasLayout =>
    view.layouts[canvas] ?? { frames: {}, version: 1 },
});

/** A canvas's layout: the snapshot's when one is looked at, the server's otherwise. */
export const layoutOf = layoutData.get;

/** Nothing selected, hovered or picked with it: where a navigation leaves the selection. */
export const unpicked = {
  also: [],
  hover: null,
  selectedPage: null,
  selection: null,
} satisfies Partial<EditorStore>;

/**
 * What the editor holds of a canvas it opens with `layout`: its frames, nothing held or measured
 * yet, and nothing put aside from another canvas.
 */
export const openedCanvas = (
  canvas: string,
  layout: CanvasLayout
): Partial<EditorStore> => {
  const { canvas: open, memory } = useEditor.getState();
  const saved = withSaving(canvas, layout);
  return {
    frames: computeFrames(pagesOfCanvas(canvas), saved),
    held: {},
    layout: saved,
    memory: canvas === open ? memory : { ...memory, putAside: null },
    rects: {},
    sizes: {},
  };
};

export const useEditor = create<EditorStore>((set, get) => ({
  activePage: null,
  addView: (pageId, width, height) => {
    const page = get().frames[pageId];
    if (!page) {
      return null;
    }
    const views = page.views ?? [];
    const size = { height: height ?? page.height, width: Math.round(width) };
    const view: FrameView = {
      ...size,
      ...placeView(pageFrames(get().frames), pageId, size),
      id: viewIdFor(width, views),
    };
    get().setFrame(pageId, { ...page, views: [...views, view] });
    return viewFrameOf(pageId, view.id);
  },
  also: [],
  applyLayout: (canvas, pushed) => {
    if (canvas !== get().canvas) {
      return;
    }
    const layout = withSaving(canvas, pushed);
    set({
      frames: withGesture(
        computeFrames(pagesOfCanvas(canvas), layout),
        get().frames
      ),
      layout,
    });
  },
  canvas: null,
  frames: {},
  held: {},
  hover: null,
  layout: { frames: {}, version: 1 },
  leftTab: "chat",
  memory: emptyMemory,
  mode: modeFor(workspaceInUrl(), undefined),
  rects: {},
  removeView: (frame) => {
    const view = viewOfFrame(frame);
    const pageId = pageOfFrame(frame);
    const page = get().frames[pageId];
    if (view === null || !page) {
      return;
    }
    // A selection in it goes on in the page's own frame, all of it.
    if (get().selection?.frame === frame) {
      const picked = pickedIn(pageId, get());
      if (picked) {
        set(picked);
      }
    }
    get().setFrame(pageId, {
      ...page,
      views: (page.views ?? []).filter((v) => v.id !== view),
    });
  },
  rightTab: "design",
  route: "/",
  select: (selection) => {
    if (selection && hidesSelection(get)) {
      return;
    }
    set({ also: [], selectedPage: null, selection });
    if (selection) {
      followFrame(selection.frame);
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
    const frame = get().selection?.frame ?? first.frame;
    set({
      also: rest
        .filter((s) => showsIn(first.frame, s.frame))
        .map((s) => ({ ...s, frame })),
    });
  },
  selectPage: (pageId) => {
    if (pageId && hidesSelection(get)) {
      return;
    }
    // A view's frame selects its page, which every view of it shows (ADR 0036).
    set({
      also: [],
      selectedPage: pageId && pageOfFrame(pageId),
      selection: null,
    });
    if (pageId) {
      followFrame(pageId);
    }
  },
  setFrame: (pageId, frame) => {
    showFrame(pageId, frame);
    saveFrame(get, set, pageId);
  },
  // The pointer reports the same node many times a second; only a change is news.
  setHover: (hover) =>
    set((s) =>
      s.hover?.frame === hover?.frame && s.hover?.nodeId === hover?.nodeId
        ? s
        : { hover }
    ),
  setMode: (mode) => set({ mode }),
  setPreset: (pageId, preset) => {
    const f = get().frames[pageId];
    if (!f) {
      return;
    }
    get().setFrame(pageId, { ...f, ...sizeForPreset(preset, f), preset });
  },
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
  toggleSelected: (target) => {
    if (hidesSelection(get)) {
      return;
    }
    // Another view of the page shows the selection: the node is added there, and the rest with it.
    const picked = pickedIn(target.frame, get());
    if (!picked?.selection) {
      get().select(target);
      return;
    }
    const { also, selection } = picked;
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
}));

/**
 * Nothing shows a selection in the prototype, nor on a board view, which draws no page: nothing
 * may be selected there.
 */
const hidesSelection = (get: () => EditorStore) =>
  get().workspace === "prototype" || onBoard();

/**
 * Selects a node for a right-click. One that is already selected keeps the selection, in the view
 * it is clicked in: the menu then acts on all of it, as a menu does in Figma, at that view's
 * breakpoint.
 */
export const selectForMenu = (target: Selection) => {
  const editor = useEditor.getState();
  if (!isSelected(target.frame, target.nodeId, editor)) {
    editor.select(target);
    return;
  }
  const picked = pickedIn(target.frame, editor);
  if (picked?.selection && picked.selection !== editor.selection) {
    useEditor.setState(picked);
  }
};

/** What a canvas draws every page in (`CanvasLayout.defaults`): the open one's, or the server's. */
export const canvasDefaults = async (canvas: string) => {
  const { canvas: open, layout } = useEditor.getState();
  if (canvas === open) {
    return layout.defaults;
  }
  if (canvas === "") {
    return;
  }
  return (await api().request("canvas.get", { canvas })).defaults;
};
