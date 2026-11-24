/**
 * Frame gestures: moving and sizing a page's frame, sizing a node on the canvas or an element
 * inside a page (`beginNodeResize`), and dragging a stack's gap or padding (`beginSpacingDrag`),
 * from the press on the frame's name, a corner or a spacing band to the release. The gesture follows the pointer as every
 * gesture on the canvas does (`pointer-gesture.ts`, ADR 0133), snaps to the grid or the frames
 * around it, and is saved once when it is let go: a page's frame rounded to the pixel
 * (`setFrame`), a node in one "Resize" edit. A cancelled pointer or Escape puts it back as it was,
 * and saves nothing. A node on the canvas moved by its name is a drag (`drag.ts`, which knows
 * where it lands), followed the same way.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import type { DesignNode, Padding } from "@ultrapaint/contracts/document";
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { create } from "zustand";
import { setField, updateNodes, updateNodesWith } from "../lib/node-actions.ts";
import { TOKEN_FIELDS } from "../lib/node-fields.ts";
import { ACROSS, type Side, withSides } from "../lib/sides.ts";
import { snapsToGrid } from "../state/canvas-grid.ts";
import {
  isPicked,
  picksWith,
  togglePick,
  useCanvasPicks,
} from "../state/canvas-picks.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import {
  type HeldSize,
  holdSize,
  holdSizeUntil,
  isSaving,
  useHeldSizes,
} from "../state/node-sizing.ts";
import {
  doneDrawingFrame,
  drawingFrame,
  hold,
  holdUntil,
  setFrame,
  setFrames,
  showFrame,
} from "../state/page-layout.ts";
import { select, selectPage } from "../state/selection.ts";
import { allFrames } from "../state/surface.ts";
import { cancelCreate, useCreate } from "./create-tool.ts";
import { beginDrag, cancelDrag, endDrag, moveDrag, useDrag } from "./drag.ts";
import type { Corner } from "./frame.tsx";
import { isFrameLocked } from "./hit-test.ts";
import { followPointer, putBackGesture } from "./pointer-gesture.ts";
import {
  holdsFree,
  type Snapped,
  snapBox,
  snapPoint,
  snapToEdges,
} from "./snap.ts";
import { clearSnapGuides, showSnapGuides } from "./snap-guides.ts";
import {
  type Band,
  snapSpacing,
  spacingLabel,
  spacingTargets,
} from "./spacing-bands.ts";

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

/**
 * Puts back whatever the pointer is doing on the canvas: the gesture it follows (a frame moved or
 * sized, a marquee, a drag, a group being drawn, `pointer-gesture.ts`), or a component from the
 * Library dragged over it. Whether there was one: Escape stops there when there was.
 */
export const cancelGesture = (): boolean => {
  const followed = putBackGesture();
  const dragged = useDrag.getState().dragged !== null;
  const creating = useCreate.getState().from !== null;
  if (dragged) {
    cancelDrag();
  }
  if (creating) {
    cancelCreate();
  }
  return followed || dragged || creating;
};

/** Drags a node on the canvas by its name: put back, it stays where it was. */
export const followLooseDrag = (
  node: { frame: string; nodeId: string; origin: { x: number; y: number } },
  e: PointerAt & { readonly pointerId: number }
) => {
  followPointer(e, {
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

/**
 * Moves or sizes a page's frame (or a view's): drawn as it goes, saved once when let go. Moved, the
 * lines it snaps to are shown as it goes, and taken away when it is let go or put back.
 */
const followFrame = (
  pageId: string,
  kind: "move" | "resize",
  corner: Corner,
  start: FrameLayout,
  from: Press
) => {
  let moved = false;
  followPointer(from, {
    // Shown where it was, as saved, or as a layout pushed meanwhile has it; nothing is sent.
    cancel: () => {
      clearSnapGuides();
      const pushed = doneDrawingFrame();
      if (pushed) {
        showFrame(pushed.page, pushed.frame);
      } else {
        showFrame(pageId, start);
      }
    },
    move: (e) => {
      const { dx, dy } = movedBy(from, e);
      // With the grid on, what is moved or resized snaps to it unless ⌘/Ctrl is held.
      const onGrid = snapsToGrid(holdsFree(e));
      moved = true;
      if (kind === "move") {
        const to = { ...start, x: start.x + dx, y: start.y + dy };
        const placed = placeFrame(to, pageId, onGrid, e);
        showFrame(pageId, placed.frame);
        showSnapGuides(placed.guides);
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
    // Saved as drawn, the save winning over a layout pushed meanwhile; not moved, shown as
    // that layout has it.
    up: () => {
      clearSnapGuides();
      const pushed = doneDrawingFrame();
      const s = useEditor.getState();
      const f = s.frames[pageId];
      if (moved && f) {
        setFrame(pageId, { ...f, ...roundBox(f) });
      } else if (pushed) {
        showFrame(pushed.page, pushed.frame);
      }
    },
  });
  // After `follow`, which puts back a gesture before it: that one is done drawing its frame.
  drawingFrame(pageId);
};

/** Whether the last press on a picked frame's name moved them: its click then picks nothing. */
let movedPicks = false;

/** Whether the last press on a frame's name added it to the frames picked or took it out. */
let toggledPick = false;

/**
 * Whether the press before this click on a frame's name settled what is picked (the frames picked
 * moved together, or one added or taken out with Shift or ⌘/Ctrl): its click then picks nothing,
 * whatever keys are held by then. Asked once, by that click; the next press forgets it, when the
 * pointer was let go elsewhere and no click came.
 */
export const pickedFramesMoved = () => {
  const was = movedPicks || toggledPick;
  movedPicks = false;
  toggledPick = false;
  return was;
};

/**
 * Whether a click on a frame's name selects the frame: not the click after a press that settled
 * what is picked (`pickedFramesMoved`), whose flag it takes; always one that no press made, from
 * the keyboard (`detail` 0) or the right-click's (none).
 */
export const nameClickSelects = (detail: number | undefined): boolean => {
  const settled = pickedFramesMoved();
  return !settled || detail === undefined || detail === 0;
};

/**
 * Moves the frames picked together (`canvas-picks.ts`) by a press on any one's name: pages by
 * their frames, saved as one step, nodes on the canvas held where they go until their documents
 * have them. A locked node stays where it is.
 */
const followPicks = (ids: readonly string[], from: Press) => {
  const s = useEditor.getState();
  const boxes = allFrames();
  const pages = ids.flatMap((id) => {
    const frame = s.frames[id];
    return frameRefOf(id).kind === "page" && frame ? [{ frame, id }] : [];
  });
  const nodes = ids.flatMap((id) => {
    const ref = frameRefOf(id);
    const box = boxes[id];
    return ref.kind === "node" && box && !isFrameLocked(id)
      ? [{ before: s.held[id] ?? null, box, id, nodeId: ref.node }]
      : [];
  });
  let moved = false;
  movedPicks = false;
  followPointer(from, {
    cancel: () => {
      for (const page of pages) {
        showFrame(page.id, page.frame);
      }
      for (const node of nodes) {
        hold(node.id, node.before);
      }
    },
    move: (e) => {
      const { dx, dy } = movedBy(from, e);
      moved = true;
      for (const page of pages) {
        showFrame(page.id, {
          ...page.frame,
          x: page.frame.x + dx,
          y: page.frame.y + dy,
        });
      }
      for (const node of nodes) {
        hold(node.id, { ...node.box, x: node.box.x + dx, y: node.box.y + dy });
      }
    },
    up: () => {
      if (!moved) {
        return;
      }
      movedPicks = true;
      const { frames } = useEditor.getState();
      setFrames(
        pages.flatMap((page) => {
          const f = frames[page.id];
          return f ? [[page.id, { ...f, ...roundBox(f) }] as const] : [];
        })
      );
      const { held } = useEditor.getState();
      for (const node of nodes) {
        const to = held[node.id];
        if (to?.x !== undefined && to.y !== undefined) {
          const box = { x: Math.round(to.x), y: Math.round(to.y) };
          holdUntil(node.id, { ...node.box, ...box }, () =>
            updateNodes([{ frame: node.id, nodeId: node.nodeId }], box, "Move")
          );
        }
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
  from: Press
) => {
  const before = useEditor.getState().held[frame];
  let to: Box | null = null;
  followPointer(from, {
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
 * Whether a press on the selection's chrome begins its gesture: the main button, unless Space or
 * the Pan tool pans. Taken, it goes no further, a gesture still followed is put back, and the
 * pointer's events go to the canvas until it is let go.
 */
const takesElementPress = (e: Press): boolean => {
  const s = useEditor.getState();
  if (e.button !== 0 || s.spacePan || s.mode === "pan") {
    return false;
  }
  e.preventDefault();
  e.stopPropagation();
  putBackGesture();
  (e.currentTarget as Element | null)
    ?.closest?.("[data-canvas]")
    ?.setPointerCapture(e.pointerId);
  return true;
};

/**
 * Sizes an element inside a page by a corner of its selection (ADR 0086), which gives it a fixed
 * width and height at the view's breakpoint: drawn at the size the pointer gives it while it
 * moves, saved in one "Resize" edit when let go. Put back, it keeps its size.
 */
export const beginNodeResize = (
  e: Press,
  frame: string,
  nodeId: string,
  corner: Corner,
  rect: Box
) => {
  if (!takesElementPress(e)) {
    return;
  }
  let to: Box | null = null;
  followPointer(e, {
    cancel: () => holdSize(frame, null),
    move: (ev) => {
      const { dx, dy } = movedBy(e, ev);
      to = roundBox(resizeFrom(rect, corner, dx, dy, 1, ev.shiftKey));
      holdSize(frame, { height: to.height, nodeId, width: to.width });
    },
    up: () => {
      const resized = to;
      if (!resized) {
        return;
      }
      const { height, width } = resized;
      holdSizeUntil(frame, { height, nodeId, width }, () =>
        updateNodes([{ frame, nodeId }], { height, width }, "Resize")
      );
    },
  });
};

/** The spacing band being dragged, which the chrome keeps drawn with its value in the pill. */
export const useSpacingDrag = create<{
  dragged: {
    readonly frame: string;
    /** The bands it changes: its own, and the opposite side's with Shift. */
    readonly keys: readonly string[];
    readonly label: string;
  } | null;
}>(() => ({ dragged: null }));

/**
 * Drags a selected stack's gap or a side of its padding by its band (ADR 0145): the length
 * follows the pointer along the band's axis, snapped to the spacing scale's named steps and the
 * design system's named spacings (to the pixel with ⌘/Ctrl held), Shift giving a padding both
 * sides of its axis. Drawn live as the stack held at it, and saved once let go in one edit, as
 * the inspector's Gap and Padding write it, at the view's breakpoint. Put back, it is drawn as its
 * document has it.
 */
export const beginSpacingDrag = (
  e: Press,
  frame: string,
  node: Pick<DesignNode, "id" | "padding">,
  band: Band
) => {
  if (!takesElementPress(e)) {
    return;
  }
  const targets = spacingTargets(useDesignSystem.getState().designSystem);
  // Dragged before the last drag's save has landed, it builds on what that one holds, not on the
  // document: saved after it, a padding would put back the side the last one changed. Put back,
  // what that one holds stays held until its save lands.
  const before = useHeldSizes.getState().byFrame[frame];
  const pending =
    isSaving(before) && before.nodeId === node.id ? before : undefined;
  const padding = (pending?.padding ?? undefined) as Padding | undefined;
  let to: { held: HeldSize; sides: Side[]; value: JsonValue } | null = null;
  const done = () => useSpacingDrag.setState({ dragged: null });
  followPointer(e, {
    cancel: () => {
      done();
      holdSize(frame, isSaving(before) ? before : null);
    },
    move: (ev) => {
      const { dx, dy } = movedBy(e, ev);
      const moved = band.axis === "x" ? dx : dy;
      const snapped = snapSpacing(
        band.px + band.sign * moved,
        targets,
        holdsFree(ev)
      );
      const { side } = band;
      const sides = side ? [side, ...(ev.shiftKey ? [ACROSS[side]] : [])] : [];
      const held: HeldSize =
        band.field === "gap"
          ? { ...pending, gap: snapped.value, nodeId: node.id }
          : {
              ...pending,
              nodeId: node.id,
              padding: withSides(padding ?? node.padding, sides, snapped.value),
            };
      to = { held, sides, value: snapped.value };
      holdSize(frame, held);
      useSpacingDrag.setState({
        dragged: {
          frame,
          keys: side ? sides.map((each) => `padding-${each}`) : [band.key],
          label: spacingLabel(band.field, snapped.px, snapped.name),
        },
      });
    },
    up: () => {
      done();
      const dragged = to;
      if (!dragged) {
        return;
      }
      const target = [{ frame, nodeId: node.id }];
      const { sides, value } = dragged;
      holdSizeUntil(frame, dragged.held, () =>
        band.field === "gap"
          ? setField(TOKEN_FIELDS.gap, value, target)
          : // Each side but those dragged kept as the view draws it.
            updateNodesWith(
              target,
              (n) => ({
                padding: withSides(padding ?? n.padding, sides, value),
              }),
              "Change the padding"
            )
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
  const { mode, spacePan } = useEditor.getState();
  if (e.button === 1 || spacePan || mode === "pan") {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  // A gesture still followed (its release never came) is put back before anything of this press
  // is read: what this one starts from is where that one was, not where it was drawn meanwhile.
  putBackGesture();
  const s = useEditor.getState();
  // A press starts afresh: what the last one settled is forgotten, its click there or not.
  movedPicks = false;
  toggledPick = false;
  // A name pressed with Shift or ⌘/Ctrl adds its frame to the frames picked, or takes it out.
  if (kind === "move" && e.button === 0 && picksWith(e)) {
    togglePick(frameId);
    toggledPick = true;
    return;
  }
  // The pointer's events go to the canvas while the gesture lasts, not to the frames under it.
  const capture = () =>
    (e.currentTarget as Element | null)
      ?.closest?.("[data-canvas]")
      ?.setPointerCapture(e.pointerId);
  // A picked frame's name moves every frame picked with it.
  const picks = useCanvasPicks.getState().ids;
  if (kind === "move" && isPicked(picks, frameId)) {
    capture();
    followPicks(picks, e);
    return;
  }
  const ref = frameRefOf(frameId);
  if (ref.kind === "node") {
    const nodeId = ref.node;
    const box = allFrames()[frameId];
    if (!box) {
      return;
    }
    select({ frame: frameId, nodeId });
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
  selectPage(frameId);
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
 * the frames around it, unless Shift or ⌘/Ctrl is held; with the lines it snapped to, which only
 * the edges give.
 */
export const placeFrame = (
  f: FrameLayout,
  pageId: string,
  onGrid: boolean,
  e: Pick<PointerAt, "ctrlKey" | "metaKey" | "shiftKey">
): Snapped => {
  if (onGrid) {
    return { frame: { ...f, ...snapPoint(f) }, guides: [] };
  }
  if (e.shiftKey || holdsFree(e)) {
    return { frame: f, guides: [] };
  }
  const s = useEditor.getState();
  const others = Object.entries(s.frames)
    .filter(([id]) => id !== pageId)
    .map(([, o]) => o);
  return snapToEdges(f, others, 8 / s.view.zoom);
};
