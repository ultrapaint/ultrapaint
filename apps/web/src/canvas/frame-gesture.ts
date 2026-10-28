/**
 * Frame gestures: moving and sizing a page's frame, and sizing a node on the canvas, from the
 * press on the frame's name or corner to the release. The gesture follows the pointer on the
 * window, snaps to the grid or the frames around it, and is saved once when it is let go: a page's
 * frame rounded to the pixel (`setFrame`), a node in one "Resize" edit. A cancelled pointer or
 * Escape puts it back as it was, and saves nothing. A node on the canvas moved by its name is a
 * drag (`drag.ts`, which knows where it lands), followed the same way.
 */
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { updateNodes } from "../lib/node-actions.ts";
import { snapsToGrid } from "../state/canvas-grid.ts";
import { isNodeFrame, NODE_FRAME_PREFIX } from "../state/documents.ts";
import {
  allFrames,
  type Box,
  hold,
  holdUntil,
  showFrame,
  useEditor,
} from "../state/editor.ts";
import { cancelCreate, useCreate } from "./create-tool.ts";
import { beginDrag, cancelDrag, endDrag, moveDrag, useDrag } from "./drag.ts";
import type { Corner } from "./frame.tsx";
import { isFrameLocked } from "./hit-test.ts";
import { holdsFree, snapBox, snapPoint, snapToEdges } from "./snap.ts";

/** Where the pointer is and the keys held with it, as a pointer event says. */
interface PointerAt {
  altKey: boolean;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** A press on a frame's name or corner, as its chrome hands it on. */
interface Press extends PointerAt {
  button: number;
  currentTarget: EventTarget;
  pointerId: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** What puts back the gesture being followed and stops following it; null when there is none. */
let putBack: (() => void) | null = null;

/** Whether a gesture follows the pointer: what the canvas would show under it waits. */
export const isFollowing = () => putBack !== null;

/**
 * Follows the pointer on the window until it is let go (`up`) or the browser takes it away
 * (`cancel`). A gesture still followed (its pointerup never came) is put back first: put back
 * after, it would take the new one with it.
 */
const follow = (gesture: {
  move: (e: PointerEvent) => void;
  up: () => void;
  cancel: () => void;
}) => {
  putBack?.();
  const stop = () => {
    window.removeEventListener("pointermove", gesture.move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    putBack = null;
  };
  const up = () => {
    stop();
    gesture.up();
  };
  const cancel = () => {
    stop();
    gesture.cancel();
  };
  putBack = cancel;
  window.addEventListener("pointermove", gesture.move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
};

/**
 * Puts back whatever the pointer is doing on the canvas: a frame gesture, a drag, a group or a
 * text being drawn. Whether there was one: Escape stops there when there was.
 */
export const cancelGesture = (): boolean => {
  const following = putBack !== null;
  const dragged = useDrag.getState().dragged !== null;
  const creating = useCreate.getState().from !== null;
  putBack?.();
  if (dragged) {
    cancelDrag();
  }
  if (creating) {
    cancelCreate();
  }
  return following || dragged || creating;
};

/** Drags a node on the canvas by its name: put back, it stays where it was. */
export const followLooseDrag = (
  node: { frame: string; nodeId: string; origin: { x: number; y: number } },
  e: PointerAt
) => {
  follow({
    cancel: cancelDrag,
    move: (ev) => moveDrag(ev.clientX, ev.clientY, ev.altKey, holdsFree(ev)),
    up: () => endDrag(),
  });
  beginDrag(
    { ...node, kind: "loose" },
    e.clientX,
    e.clientY,
    e.altKey,
    holdsFree(e)
  );
};

/** The way the pointer has moved since the press, in the canvas's units. */
const movedBy = (from: PointerAt, to: PointerAt) => {
  const { zoom } = useEditor.getState().view;
  return {
    dx: (to.clientX - from.clientX) / zoom,
    dy: (to.clientY - from.clientY) / zoom,
  };
};

const roundBox = (b: Box): Box => ({
  height: Math.round(b.height),
  width: Math.round(b.width),
  x: Math.round(b.x),
  y: Math.round(b.y),
});

/** Moves or sizes a page's frame (or a view's): drawn as it goes, saved once when let go. */
const followFrame = (
  pageId: string,
  kind: "move" | "resize",
  corner: Corner,
  start: FrameLayout,
  from: PointerAt
) => {
  let moved = false;
  follow({
    // Shown where it was, as saved; nothing is sent.
    cancel: () => showFrame(pageId, start),
    move: (e) => {
      const { dx, dy } = movedBy(from, e);
      // With the grid on, what is moved or resized snaps to it unless ⌘/Ctrl is held.
      const onGrid = snapsToGrid(holdsFree(e));
      moved = true;
      if (kind === "move") {
        const to = { ...start, x: start.x + dx, y: start.y + dy };
        showFrame(pageId, placeFrame(to, pageId, onGrid, e));
        return;
      }
      const resized = resizeFrom(start, corner, dx, dy, 120, e.shiftKey);
      showFrame(pageId, {
        ...start,
        ...(onGrid
          ? snapBox(resized, start, corner, 120, e.shiftKey)
          : resized),
        preset: "custom",
      });
    },
    up: () => {
      const s = useEditor.getState();
      const f = s.frames[pageId];
      if (moved && f) {
        s.setFrame(pageId, { ...f, ...roundBox(f) });
      }
    },
  });
};

/**
 * Sizes a node on the canvas, which gives it a fixed size: held at the size it is given while the
 * pointer moves, so its frame draws it so; kept there once let go until its document has it.
 */
const followNodeResize = (
  frame: string,
  nodeId: string,
  corner: Corner,
  start: Box,
  from: PointerAt
) => {
  const before = useEditor.getState().held[frame];
  let to: Box | null = null;
  follow({
    // Drawn as it was held before, its document's size when it was not.
    cancel: () => hold(frame, before ?? null),
    move: (e) => {
      const { dx, dy } = movedBy(from, e);
      const resized = resizeFrom(start, corner, dx, dy, 8, e.shiftKey);
      to = roundBox(
        snapsToGrid(holdsFree(e))
          ? snapBox(resized, start, corner, 8, e.shiftKey)
          : resized
      );
      hold(frame, to);
    },
    up: () => {
      const resized = to;
      if (!resized || useEditor.getState().canvas === null) {
        hold(frame, before ?? null);
        return;
      }
      const { height, width, x, y } = resized;
      holdUntil(frame, resized, () =>
        updateNodes([{ frame, nodeId }], { height, width, x, y }, "Resize")
      );
    },
  });
};

/**
 * A press on a frame's name (`move`) or corner (`resize`) begins its gesture, and selects the
 * frame. A node on the canvas moved by its name is dragged; a locked one is only selected. A press
 * of the middle button, or with Space held or the Pan tool, is left to the canvas, which pans.
 */
export const beginFrameGesture = (
  e: Press,
  frameId: string,
  kind: "move" | "resize",
  corner: Corner = "se"
) => {
  const s = useEditor.getState();
  if (e.button === 1 || s.spacePan || s.mode === "pan") {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  // The pointer's events go to the canvas while the gesture lasts, not to the frames under it.
  const capture = () =>
    (e.currentTarget as Element | null)
      ?.closest?.("[data-canvas]")
      ?.setPointerCapture(e.pointerId);
  if (isNodeFrame(frameId)) {
    const nodeId = frameId.slice(NODE_FRAME_PREFIX.length);
    const box = allFrames()[frameId];
    if (!box) {
      return;
    }
    s.select({ frame: frameId, nodeId });
    // A locked node is picked up by its name, and stays where it is and the size it is.
    if (isFrameLocked(frameId)) {
      return;
    }
    if (kind === "move") {
      followLooseDrag(
        { frame: frameId, nodeId, origin: { x: box.x, y: box.y } },
        e
      );
      return;
    }
    capture();
    followNodeResize(frameId, nodeId, corner, box, e);
    return;
  }
  const frame = s.frames[frameId];
  if (!frame) {
    return;
  }
  capture();
  followFrame(frameId, kind, corner, frame, e);
  s.selectPage(frameId);
};

/**
 * The box left once `corner` is dragged by (dx, dy): the opposite corner stays where it was, and
 * neither side goes under `min`. Keeping the ratio (Shift), the side the pointer moved further
 * decides.
 */
export const resizeFrom = (
  box: Box,
  corner: Corner,
  dx: number,
  dy: number,
  min: number,
  keepRatio: boolean
): Box => {
  const west = corner.endsWith("w");
  const north = corner.startsWith("n");
  let width = Math.max(min, box.width + (west ? -dx : dx));
  let height = Math.max(min, box.height + (north ? -dy : dy));
  if (keepRatio) {
    const sx = width / box.width;
    const sy = height / box.height;
    const k = Math.max(
      Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy,
      min / Math.min(box.width, box.height)
    );
    width = box.width * k;
    height = box.height * k;
  }
  return {
    height,
    width,
    x: west ? box.x + box.width - width : box.x,
    y: north ? box.y + box.height - height : box.y,
  };
};

/**
 * Where a page frame being moved goes: on the grid when it snaps, otherwise against the edges of
 * the frames around it, unless Shift or ⌘/Ctrl is held.
 */
export const placeFrame = (
  f: FrameLayout,
  pageId: string,
  onGrid: boolean,
  e: Pick<PointerAt, "ctrlKey" | "metaKey" | "shiftKey">
): FrameLayout => {
  if (onGrid) {
    return { ...f, ...snapPoint(f) };
  }
  if (e.shiftKey || holdsFree(e)) {
    return f;
  }
  const s = useEditor.getState();
  const others = Object.entries(s.frames)
    .filter(([id]) => id !== pageId)
    .map(([, o]) => o);
  return snapToEdges(f, others, 8 / s.view.zoom);
};
