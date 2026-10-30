/**
 * Where the page canvas's frames are (ADR 0036, 0039): the pages' frames and their views as the
 * open canvas's layout saves them, the pages it does not place yet where `canvas-layout` puts
 * them, and the nodes beside the pages where their documents put them (held where the pointer
 * put one until its document has it). The layout is saved as it changes, a page at a time and
 * only what changed, so a layout an agent pushed meanwhile is kept; a frame gesture draws its
 * frame as it goes and sets it once let go. The frames are written to `useEditor.frames`, which
 * the canvas, the camera and the selection read.
 */
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
import { sizeForPreset } from "../lib/presets.ts";
import { api } from "./connection.ts";
import { canvasNodes, useDocuments } from "./documents.ts";
import { type EditorState, pagesOfCanvas, useEditor } from "./editor.ts";
import { frameRefOf, nodeFrameOf, viewFrameOf } from "./frame-ref.ts";
import { reportError } from "./project.ts";
import { pickedIn } from "./selection.ts";
import { follow } from "./server-data.ts";
import { viewedSnapshot } from "./snapshot-view.ts";

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
 * The page a frame of the layout is of, and the view it is; null for the page's own frame. The
 * layout holds pages' frames and their views only.
 */
const viewIn = (id: string): { page: string; view: string | null } => {
  const ref = frameRefOf(id);
  return ref.kind === "view"
    ? { page: ref.page, view: ref.view }
    : { page: id, view: null };
};

const isView = (id: string) => frameRefOf(id).kind === "view";

/**
 * The frames with their pages' views among them, each a box of its own where its page's frame
 * puts it (ADR 0036): a view's place is counted from its page's frame, so it moves with it.
 */
const placeViews = (
  frames: Record<string, FrameLayout>
): Record<string, FrameLayout> => {
  const out: Record<string, FrameLayout> = {};
  for (const [id, frame] of Object.entries(frames)) {
    if (isView(id)) {
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
  const { page: pageId, view } = viewIn(id);
  if (view === null) {
    // A frame given without its views keeps those it has.
    const views = "views" in box ? box.views : frames[id]?.views;
    return placeViews({
      ...frames,
      [id]: { ...box, ...(views && views.length > 0 ? { views } : {}) },
    });
  }
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
  Object.fromEntries(Object.entries(frames).filter(([id]) => !isView(id)));

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
  gesture = { page: viewIn(frame).page, pushed: null };
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
const saveFrame = (frame: string) => {
  const { frames, layout, canvas } = useEditor.getState();
  // A snapshot's frames move on screen and nowhere else.
  if (canvas === null || viewedSnapshot()) {
    return;
  }
  const changed = viewIn(frame).page;
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
  useEditor.setState({
    layout: { ...layout, frames: { ...layout.frames, ...sent } },
  });
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
  apply: (layout: CanvasLayout, canvas: string) => applyLayout(canvas, layout),
  key: () => useEditor.getState().canvas,
  // Every canvas's layout is told; one told while a read is on its way waits for its answer.
  news: ["canvas"],
  on: {
    canvas: ({ canvas, layout }) => applyLayout(canvas, layout),
  },
  read: (canvas) => api().request("canvas.get", { canvas }),
  snapshot: (view, canvas): CanvasLayout =>
    view.layouts[canvas] ?? { frames: {}, version: 1 },
});

/** A canvas's layout: the snapshot's when one is looked at, the server's otherwise. */
export const layoutOf = layoutData.get;

/**
 * What the editor holds of a canvas it opens with `layout`: its frames, nothing held or measured
 * yet, and nothing put aside from another canvas.
 */
export const openedCanvas = (
  canvas: string,
  layout: CanvasLayout
): Partial<EditorState> => {
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

/**
 * Sets a frame and saves it at once: a page's (its views move with it) or a view's, in its
 * page's frame (ADR 0036). A page's frame given without views keeps the ones it has. A frame
 * gesture shows the frame as it goes (`showFrame`) and sets it once when it is let go.
 */
export const setFrame = (pageId: string, frame: FrameLayout) => {
  showFrame(pageId, frame);
  saveFrame(pageId);
};

/** Sizes a page's frame for a device, saved. */
export const setPreset = (pageId: string, preset: ViewportPreset) => {
  const f = useEditor.getState().frames[pageId];
  if (!f) {
    return;
  }
  setFrame(pageId, { ...f, ...sizeForPreset(preset, f), preset });
};

/** Draws a page again at another width beside its frame; the new view's frame id. */
export const addView = (
  pageId: string,
  width: number,
  height?: number
): string | null => {
  const { frames } = useEditor.getState();
  const page = frames[pageId];
  if (!page) {
    return null;
  }
  const views = page.views ?? [];
  const size = { height: height ?? page.height, width: Math.round(width) };
  const view: FrameView = {
    ...size,
    ...placeView(pageFrames(frames), pageId, size),
    id: viewIdFor(width, views),
  };
  setFrame(pageId, { ...page, views: [...views, view] });
  return viewFrameOf(pageId, view.id);
};

/** Takes a view of a page away, by its frame id: a selection in it goes on in the page's frame. */
export const removeView = (frame: string) => {
  const editor = useEditor.getState();
  const { page: pageId, view } = viewIn(frame);
  const page = editor.frames[pageId];
  if (view === null || !page) {
    return;
  }
  if (editor.selection?.frame === frame) {
    const picked = pickedIn(pageId, editor);
    if (picked) {
      useEditor.setState(picked);
    }
  }
  setFrame(pageId, {
    ...page,
    views: (page.views ?? []).filter((v) => v.id !== view),
  });
};

/**
 * Follows the layout as saved: an undo, an agent, a branch switch. A page whose save the server
 * has not answered yet stays where the editor put it; the push after the answer brings it.
 */
export const applyLayout = (canvas: string, pushed: CanvasLayout) => {
  const editor = useEditor.getState();
  if (canvas !== editor.canvas) {
    return;
  }
  const layout = withSaving(canvas, pushed);
  useEditor.setState({
    frames: withGesture(
      computeFrames(pagesOfCanvas(canvas), layout),
      editor.frames
    ),
    layout,
  });
};

/**
 * The page canvas's frames, pages, their views and the nodes beside the pages alike: what fits,
 * zooms and drops look at there.
 */
export const pageCanvasFrames = (): Record<string, Box> => {
  const { frames, held, sizes, canvas } = useEditor.getState();
  const out: Record<string, Box> = { ...frames };
  for (const node of canvasNodes(useDocuments.getState().docs, canvas)) {
    const frame = nodeFrameOf(node.id);
    out[frame] = { ...nodeFrameLayout(node, sizes[frame]), ...held[frame] };
  }
  return out;
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
