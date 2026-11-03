/**
 * The marquee drawn over the page canvas's ground, Figma's way: a press on nothing with the select
 * tool, dragged, draws it, and the frames it touches (pages and nodes placed on the canvas) are
 * picked as it is drawn (`state/canvas-picks.ts`); with Shift it adds to what was picked or
 * selected. Let go, one frame is the selection and several stay picked. A press let go without
 * moving is the ground's own press. Escape puts it away, back to what was picked before. A marquee
 * that begins inside a page is the page's (`use-frame-pointer.ts`).
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import { create } from "zustand";
import { useInv } from "../state/camera.ts";
import {
  pickedFrameOf,
  pickFrames,
  showPicks,
  useCanvasPicks,
} from "../state/canvas-picks.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { allFrames, surfaceNow } from "../state/surface.ts";
import { canvasPoint } from "./drag.ts";
import { drawingMarquee } from "./frame-gesture.ts";

/** The marquee as drawn, in the canvas's coordinates; null while none is. */
export const useCanvasMarquee = create<{ rect: Box | null }>(() => ({
  rect: null,
}));

/** How far the pointer moves, in screen pixels, before a press draws a marquee. */
const MOVE_PX = 3;

/** The frames `rect` touches, by the frame each is picked by (a view picks its page). */
export const framesTouching = (
  rect: Box,
  frames: Readonly<Record<string, Box>>
): string[] => {
  const touched = new Set<string>();
  for (const [id, box] of Object.entries(frames)) {
    if (
      box.x < rect.x + rect.width &&
      box.x + box.width > rect.x &&
      box.y < rect.y + rect.height &&
      box.y + box.height > rect.y
    ) {
      touched.add(pickedFrameOf(id));
    }
  }
  return [...touched];
};

/** The marquee being drawn: where it began, on the canvas and the screen, and what it adds to. */
let drawing: {
  readonly before: readonly string[];
  readonly client: { readonly x: number; readonly y: number };
  readonly from: { readonly x: number; readonly y: number };
  moved: boolean;
} | null = null;

/** What is picked now, which a marquee drawn with Shift adds to: the picks, or the frame selected. */
const pickedNow = (): readonly string[] => {
  const { ids } = useCanvasPicks.getState();
  if (ids.length > 0) {
    return ids;
  }
  const { selectedPage, selection } = useEditor.getState();
  if (selectedPage) {
    return [selectedPage];
  }
  const ref = selection ? frameRefOf(selection.frame) : null;
  return selection && ref?.kind === "node" && ref.node === selection.nodeId
    ? [selection.frame]
    : [];
};

/** A press on the ground begins a marquee, drawn once the pointer moves. */
export const beginCanvasMarquee = (e: {
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
}) => {
  drawing = {
    before: e.shiftKey ? pickedNow() : [],
    client: { x: e.clientX, y: e.clientY },
    from: canvasPoint(e.clientX, e.clientY),
    moved: false,
  };
  drawingMarquee(cancelCanvasMarquee);
};

export const isDrawingCanvasMarquee = () => drawing !== null;

/** The pointer moved: the marquee to it, and what it touches picked. */
export const moveCanvasMarquee = (e: {
  readonly clientX: number;
  readonly clientY: number;
}) => {
  if (!drawing) {
    return;
  }
  const { client, from } = drawing;
  if (
    !drawing.moved &&
    Math.hypot(e.clientX - client.x, e.clientY - client.y) < MOVE_PX
  ) {
    return;
  }
  drawing.moved = true;
  const to = canvasPoint(e.clientX, e.clientY);
  const rect = {
    height: Math.abs(to.y - from.y),
    width: Math.abs(to.x - from.x),
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
  };
  useCanvasMarquee.setState({ rect });
  showPicks([
    ...new Set([...drawing.before, ...framesTouching(rect, allFrames())]),
  ]);
};

const stop = () => {
  const was = drawing;
  drawing = null;
  drawingMarquee(null);
  useCanvasMarquee.setState({ rect: null });
  return was;
};

/** Let go: what it touched is picked, one frame selected; not moved, the ground was pressed. */
export const endCanvasMarquee = () => {
  const was = stop();
  if (!was) {
    return;
  }
  if (was.moved) {
    pickFrames(useCanvasPicks.getState().ids);
  } else {
    surfaceNow().onGroundPress();
  }
};

/** Escape, or a cancelled pointer: back to what was picked before it. */
export const cancelCanvasMarquee = () => {
  const was = stop();
  if (was?.moved) {
    pickFrames(was.before);
  }
};

/** The marquee, drawn over the frames in the zoomed layer at a constant width on screen. */
export const CanvasMarquee = () => {
  const rect = useCanvasMarquee((s) => s.rect);
  const inv = useInv();
  if (!rect) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        background: "color-mix(in srgb, var(--selection) 8%, transparent)",
        height: rect.height,
        left: rect.x,
        outline: `${inv}px solid var(--selection)`,
        top: rect.y,
        width: rect.width,
        zIndex: 3,
      }}
    />
  );
};
