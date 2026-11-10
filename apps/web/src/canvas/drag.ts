/**
 * Dragging things across the canvas: a node to another place in its page, into another page or
 * out onto the canvas; a node on the canvas around it or into a page; something new from the
 * Library into a page or onto the canvas. One controller for all of them, because they share the
 * question that matters — where would this land — and the line that answers it. The documents
 * say what is a container and which way it lays out its children, so the answer is read off
 * them, and only the rectangles are asked of the preview.
 *
 * Alt copies instead of moving, as it does in every design tool. With the grid on, what lands on
 * the canvas lands on the grid, unless ⌘/Ctrl is held.
 */

import type { Box } from "@ultrapaint/contracts/canvas-layout";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { runsInRow } from "@ultrapaint/design-document/css";
import {
  canvasDocOf,
  childrenOf,
  findPath,
} from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import {
  insertNodesAt,
  moveNode,
  nodesOf,
  type Place,
} from "../lib/node-actions.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { holdsChildren } from "../state/components.ts";
import { docOfFrame, rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { holdUntil } from "../state/page-layout.ts";
import { allFrames, surfaceNow } from "../state/surface.ts";
import { frameOf } from "./editor-frame.ts";
import { snapPoint } from "./snap.ts";

/** Type of the data a Library entry's drag carries: the node it inserts, as JSON. */
export const LIBRARY_MIME = "application/ultrapaint-node";

export type Dragged =
  | {
      frame: string;
      kind: "node";
      node: DesignNode;
      /** Where the node was, in its frame, when the drag began. */
      rect: Rect;
    }
  | {
      /** A node placed on the canvas, moved whole. */
      frame: string;
      kind: "loose";
      nodeId: string;
      /** Where it was when the drag began. */
      origin: { x: number; y: number };
    }
  | { kind: "new"; name: string };

/** Where a drop would land, with what to draw for it; coordinates are the canvas's own. */
export type Drop =
  | {
      /** The container, outlined when the node would become its only child. */
      box: Rect | null;
      frame: string;
      index: number;
      /** The line between the siblings it would land between. */
      line: Rect | null;
      kind: "into";
      parent: string;
    }
  | { kind: "canvas" };

interface DragStore {
  copy: boolean;
  dragged: Dragged | null;
  drop: Drop | null;
  /** ⌘/Ctrl is held: it lands where it is let go, off the grid. */
  free: boolean;
  /** Where the pointer holds what it drags, from that thing's top left corner. */
  grab: { x: number; y: number };
  /** Pointer position on the canvas. */
  pointer: { x: number; y: number };
}

export const useDrag = create<DragStore>(() => ({
  copy: false,
  dragged: null,
  drop: null,
  free: false,
  grab: { x: 0, y: 0 },
  pointer: { x: 0, y: 0 },
}));

/**
 * Where what is dragged would land on the canvas: its top left corner, on the grid when it
 * snaps. `grid` is passed by a component that redraws when the grid is switched.
 */
export const landingPoint = (
  pointer: { x: number; y: number },
  grab: { x: number; y: number },
  free: boolean,
  grid = useCanvasGrid.getState().visible
) => {
  const at = { x: pointer.x - grab.x, y: pointer.y - grab.y };
  return grid && !free ? snapPoint(at) : round(at);
};

// ---- Geometry ----

/**
 * Where the ground is in the window, as the ground on screen measured it when it was laid out
 * (`CanvasGround`): a pointer move reading it off the DOM would make the browser lay out again
 * what the last move changed, once per event. The window's corner while no ground is on screen.
 */
let ground = { left: 0, top: 0 };

/** The ground on screen says where it is, whenever it is laid out; the window's corner as it goes. */
export const groundIsAt = (origin: { left: number; top: number }) => {
  ground = origin;
};

/** A pointer event's position in the canvas's own coordinates. */
export const canvasPoint = (clientX: number, clientY: number) => {
  const { x, y, zoom } = useEditor.getState().view;
  return {
    x: (clientX - ground.left - x) / zoom,
    y: (clientY - ground.top - y) / zoom,
  };
};

/** The frame under a canvas point: nodes on the canvas lie over pages. */
const frameAt = (x: number, y: number, except?: string): string | null => {
  const inside = ([id, f]: [string, Box]) =>
    id !== except &&
    x >= f.x &&
    y >= f.y &&
    x <= f.x + f.width &&
    y <= f.y + f.height;
  const entries = Object.entries(allFrames());
  const isNode = ([id]: [string, Box]) => frameRefOf(id).kind === "node";
  const node = entries.filter(isNode).findLast(inside);
  return (node ?? entries.find((e) => !isNode(e) && inside(e)))?.[0] ?? null;
};

const offset = (r: Rect, f: Box): Rect => ({
  height: r.height,
  width: r.width,
  x: r.x + f.x,
  y: r.y + f.y,
});

/** The line in front of `rect`, or after it, across the axis the siblings run along. */
const lineAt = (r: Rect, row: boolean, after: boolean): Rect =>
  row
    ? { height: r.height, width: 0, x: after ? r.x + r.width : r.x, y: r.y }
    : { height: 0, width: r.width, x: r.x, y: after ? r.y + r.height : r.y };

// ---- Where a drop lands ----

/** The dragged node, when it lives in the document being dropped into. */
const draggedIn = (dragged: Dragged, doc: string): string | null => {
  const { canvas } = useEditor.getState();
  if (dragged.kind === "node" && docOfFrame(dragged.frame, canvas) === doc) {
    return dragged.node.id;
  }
  if (dragged.kind === "loose" && doc === canvasDocOf(canvas ?? "")) {
    return dragged.nodeId;
  }
  return null;
};

/** Where something dropped inside `container` goes: before the first child the pointer is above. */
export const dropInside = (
  frameId: string,
  container: DesignNode,
  own: Rect,
  children: readonly DesignNode[],
  rects: Record<string, Rect>,
  frame: Box,
  px: number,
  py: number
): Drop => {
  const boxes = children.map((c) => {
    const r = rects[c.id];
    return r ? offset(r, frame) : null;
  });
  const row = runsInRow(container, boxes);
  let index = children.length;
  for (const [i, r] of boxes.entries()) {
    const mid = r && (row ? r.x + r.width / 2 : r.y + r.height / 2);
    if (mid !== null && (row ? px : py) < mid) {
      index = i;
      break;
    }
  }
  const before = boxes[index];
  const last = boxes.filter((b): b is Rect => b !== null).at(-1);
  let line: Rect | null = null;
  if (before) {
    line = lineAt(before, row, false);
  } else if (last) {
    line = lineAt(last, row, true);
  }
  return {
    box: children.length === 0 ? own : null,
    frame: frameId,
    index,
    kind: "into",
    line,
    parent: container.id,
  };
};

/** A node on the way down to the pointer, and what a drop there has to know. */
interface Spot {
  /** The dragged node, which is not a place to drop it. */
  readonly exclude: string | null;
  readonly frame: Box;
  readonly frameId: string;
  readonly node: DesignNode;
  readonly parent: DesignNode | null;
}

/**
 * How much of a node, from each end, means beside it rather than inside it: all of it when it
 * cannot hold anything. A component is often small and sits among others, so more of it does.
 */
const edgeOf = (node: DesignNode, holds: boolean) => {
  if (!holds) {
    return 0.5;
  }
  return node.type === "instance" ? 0.3 : 0.2;
};

/** The drop one node offers: beside it near its edges, else inside it when it holds others. */
export const dropAt = (spot: Spot, px: number, py: number): Drop | null => {
  const { exclude, frame, frameId, node, parent } = spot;
  const holds = holdsChildren(node);
  const inner = holds ? childrenOf(node).filter((c) => c.id !== exclude) : [];
  const siblings = parent
    ? childrenOf(parent).filter((c) => c.id !== exclude)
    : [];
  // The siblings too: which way they run is read off where they are drawn.
  const ids = new Set([node, ...inner, ...siblings].map((n) => n.id));
  const rects = frameOf(frameId).measure([...ids]);
  const own = rects[node.id];
  if (!own) {
    return null;
  }
  const r = offset(own, frame);
  const row = parent
    ? runsInRow(
        parent,
        siblings.map((c) => rects[c.id])
      )
    : false;
  const t = row ? (px - r.x) / r.width : (py - r.y) / r.height;
  const edge = edgeOf(node, holds);
  const at = siblings.findIndex((c) => c.id === node.id);
  if (parent && at >= 0 && (!holds || t < edge || t > 1 - edge)) {
    const after = t >= 0.5;
    return {
      box: null,
      frame: frameId,
      index: at + (after ? 1 : 0),
      kind: "into",
      line: lineAt(r, row, after),
      parent: parent.id,
    };
  }
  return holds
    ? dropInside(frameId, node, r, inner, rects, frame, px, py)
    : null;
};

/**
 * Where something dropped at this point of a frame goes: inside the innermost container under
 * it, or beside the innermost node, whichever the pointer is nearer to meaning.
 */
const placementIn = (
  frameId: string,
  px: number,
  py: number,
  dragged: Dragged
): Drop | null => {
  const s = useEditor.getState();
  const frame = allFrames()[frameId];
  const root = rootOfFrame(useDocuments.getState().docs, s.canvas, frameId);
  if (!(frame && root)) {
    return null;
  }
  const doc = docOfFrame(frameId, s.canvas);
  const exclude = draggedIn(dragged, doc);
  const chain = frameOf(frameId).hitTest(px - frame.x, py - frame.y);
  const innermost = chain.at(-1) ?? root.id;
  const path = findPath(root, innermost) ?? [root];
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (exclude && path.slice(0, i + 1).some((n) => n.id === exclude)) {
      continue;
    }
    const at: Spot = {
      exclude,
      frame,
      frameId,
      node: path[i] as DesignNode,
      parent: (path[i - 1] as DesignNode | undefined) ?? null,
    };
    // The innermost that takes the drop wins.
    const drop = dropAt(at, px, py);
    if (drop) {
      return drop;
    }
  }
  return null;
};

// ---- The drag itself ----

/** Starts a drag. What is dragged keeps its place until the drop. */
export const beginDrag = (
  dragged: Dragged,
  clientX: number,
  clientY: number,
  alt: boolean,
  free = false
) => {
  const p = canvasPoint(clientX, clientY);
  let grab = { x: 0, y: 0 };
  const frames = allFrames();
  if (dragged.kind === "node") {
    const frame = frames[dragged.frame];
    grab = frame
      ? {
          x: p.x - (frame.x + dragged.rect.x),
          y: p.y - (frame.y + dragged.rect.y),
        }
      : grab;
  } else if (dragged.kind === "loose") {
    grab = { x: p.x - dragged.origin.x, y: p.y - dragged.origin.y };
  }
  useDrag.setState({ copy: alt, dragged, drop: null, free, grab, pointer: p });
  useEditor.getState().setHover(null);
};

/** Follows the pointer: where it would land is asked of the frame under it as it goes. */
export const moveDrag = (
  clientX: number,
  clientY: number,
  alt: boolean,
  free = false
) => {
  const { dragged } = useDrag.getState();
  if (!dragged) {
    return;
  }
  const p = canvasPoint(clientX, clientY);
  useDrag.setState({
    copy: alt,
    drop: resolveDrop(p.x, p.y, dragged),
    free,
    pointer: p,
  });
};

const resolveDrop = (x: number, y: number, dragged: Dragged): Drop | null => {
  const except = dragged.kind === "loose" ? dragged.frame : undefined;
  const frameId = frameAt(x, y, except);
  if (!frameId) {
    // A node on the canvas dragged over nothing is only being moved; anything else lands there,
    // on a ground that is a document: a board view's is none (ADR 0045).
    return dragged.kind === "loose" || !surfaceNow().groundDrops
      ? null
      : { kind: "canvas" };
  }
  return placementIn(frameId, x, y, dragged);
};

export const cancelDrag = () => useDrag.setState({ dragged: null, drop: null });

const round = (p: { x: number; y: number }) => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
});

/** The place a drop puts something, `at` being where it lands on the canvas. */
export const placeOfDrop = (drop: Drop, at: { x: number; y: number }): Place =>
  drop.kind === "canvas" ? { at, kind: "canvas" } : drop;

/** Carries the drop out. `created` is the node a Library drag inserts. */
export const endDrag = async (created?: DesignNode) => {
  const { copy, dragged, drop, free, grab, pointer } = useDrag.getState();
  const at = landingPoint(pointer, grab, free);
  const land = () => carryOut(dragged, drop, at, copy, created);
  // A node on the canvas that moves is held where it was let go before the drag lets go of it:
  // drawn from its document alone, it would jump back until the server answers.
  const landing =
    dragged?.kind === "loose" && !copy
      ? holdUntil(dragged.frame, at, land)
      : null;
  useDrag.setState({ dragged: null, drop: null });
  await (landing ?? land());
};

/**
 * What a drop does: a node from the Library inserted, one dragged copied or moved. A node on
 * the canvas let go over the canvas moves to where it was let go.
 */
const carryOut = async (
  dragged: Dragged | null,
  drop: Drop | null,
  at: { x: number; y: number },
  copy: boolean,
  created: DesignNode | undefined
) => {
  const { canvas } = useEditor.getState();
  if (!dragged || canvas === null) {
    return;
  }
  if (dragged.kind === "new") {
    if (drop && created) {
      await insertNodesAt(placeOfDrop(drop, at), [created]);
    }
    return;
  }
  const target =
    dragged.kind === "loose"
      ? { frame: dragged.frame, nodeId: dragged.nodeId }
      : { frame: dragged.frame, nodeId: dragged.node.id };
  const place =
    dragged.kind === "loose" && drop?.kind !== "into"
      ? ({ at, kind: "canvas" } as const)
      : drop && placeOfDrop(drop, at);
  if (!place) {
    return;
  }
  if (copy) {
    const [node] = nodesOf([target]);
    if (node) {
      await insertNodesAt(
        place,
        [node.node],
        dragged.kind === "loose" && place.kind === "canvas"
          ? "Copy on the canvas"
          : "Copy"
      );
    }
    return;
  }
  await moveNode(target, place);
};

// ---- Placing something new without a drag ----

/** Where something new put at this canvas point would land. */
export const placementAt = (x: number, y: number) =>
  resolveDrop(x, y, { kind: "new", name: "" });
