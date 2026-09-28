/**
 * Dragging things across the canvas: a node to another place in its page, into another page or
 * out onto the canvas; a node on the canvas around it or into a page; something new from the
 * palette into a page or onto the canvas. One controller for all of them, because they share the
 * question that matters — where would this land — and the line that answers it. The documents
 * say what is a container and which way it lays out its children, so the answer is read off
 * them, and only the rectangles are asked of the preview.
 *
 * Alt copies instead of moving, as it does in every design tool.
 */
import type { DesignNode, DocumentEdit } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { runsInRow } from "@ultrapaint/design-document/css";
import {
  canvasDocOf,
  childrenOf,
  findNode,
  findPath,
} from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { holdsChildren } from "../state/catalogue.ts";
import {
  applyEdits,
  docOfFrame,
  frameOfCanvasNode,
  isNodeFrame,
  nodeFrameOf,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { allFrames, useEditor } from "../state/editor.ts";
import { bridgeFor } from "./bridge.ts";

/** Type of the data a palette entry's drag carries: the node it inserts, as JSON. */
export const PALETTE_MIME = "application/ultrapaint-node";

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
  /** Where the pointer holds what it drags, from that thing's top left corner. */
  grab: { x: number; y: number };
  /** Pointer position on the canvas. */
  pointer: { x: number; y: number };
}

export const useDrag = create<DragStore>(() => ({
  copy: false,
  dragged: null,
  drop: null,
  grab: { x: 0, y: 0 },
  pointer: { x: 0, y: 0 },
}));

// ---- Geometry ----

/** A pointer event's position in the canvas's own coordinates. */
export const canvasPoint = (clientX: number, clientY: number) => {
  const el = document.querySelector("[data-canvas]");
  const r = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const { x, y, zoom } = useEditor.getState().view;
  return {
    x: (clientX - r.left - x) / zoom,
    y: (clientY - r.top - y) / zoom,
  };
};

interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** The frame under a canvas point: nodes on the canvas lie over pages. */
const frameAt = (x: number, y: number, except?: string): string | null => {
  const inside = ([id, f]: [string, Box]) =>
    id !== except &&
    x >= f.x &&
    y >= f.y &&
    x <= f.x + f.width &&
    y <= f.y + f.height;
  const entries = Object.entries(allFrames());
  const node = entries.filter(([id]) => isNodeFrame(id)).findLast(inside);
  return (
    (node ?? entries.find((e) => !isNodeFrame(e[0]) && inside(e)))?.[0] ?? null
  );
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
  const { space } = useEditor.getState();
  if (dragged.kind === "node" && docOfFrame(dragged.frame, space) === doc) {
    return dragged.node.id;
  }
  if (dragged.kind === "loose" && doc === canvasDocOf(space ?? "")) {
    return dragged.nodeId;
  }
  return null;
};

/** Where something dropped inside `container` goes: before the first child the pointer is above. */
const dropInside = (
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
const dropAt = async (
  spot: Spot,
  px: number,
  py: number
): Promise<Drop | null> => {
  const { exclude, frame, frameId, node, parent } = spot;
  const holds = holdsChildren(node);
  const inner = holds ? childrenOf(node).filter((c) => c.id !== exclude) : [];
  const siblings = parent
    ? childrenOf(parent).filter((c) => c.id !== exclude)
    : [];
  // The siblings too: which way they run is read off where they are drawn.
  const ids = new Set([node, ...inner, ...siblings].map((n) => n.id));
  const rects = await bridgeFor(frameId).measure([...ids]);
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
const placementIn = async (
  frameId: string,
  px: number,
  py: number,
  dragged: Dragged
): Promise<Drop | null> => {
  const s = useEditor.getState();
  const frame = allFrames()[frameId];
  const root = rootOfFrame(useDocuments.getState().docs, s.space, frameId);
  if (!(frame && root)) {
    return null;
  }
  const doc = docOfFrame(frameId, s.space);
  const exclude = draggedIn(dragged, doc);
  const chain = await bridgeFor(frameId).hitTest(px - frame.x, py - frame.y);
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
    // biome-ignore lint/performance/noAwaitInLoops: the innermost that takes the drop wins.
    const drop = await dropAt(at, px, py);
    if (drop) {
      return drop;
    }
  }
  return null;
};

// ---- The drag itself ----

let pending = false;
let queued: { clientX: number; clientY: number; alt: boolean } | null = null;

/** Starts a drag. What is dragged keeps its place until the drop. */
export const beginDrag = (
  dragged: Dragged,
  clientX: number,
  clientY: number,
  alt: boolean
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
  useDrag.setState({ copy: alt, dragged, drop: null, grab, pointer: p });
  useEditor.getState().setHover(null);
};

/** Follows the pointer. Lookups in the preview are asynchronous; only the latest one counts. */
export const moveDrag = (clientX: number, clientY: number, alt: boolean) => {
  const { dragged } = useDrag.getState();
  if (!dragged) {
    return;
  }
  const p = canvasPoint(clientX, clientY);
  useDrag.setState({ copy: alt, pointer: p });
  if (pending) {
    queued = { alt, clientX, clientY };
    return;
  }
  pending = true;
  resolveDrop(p.x, p.y, dragged)
    .then((drop) => {
      if (useDrag.getState().dragged === dragged) {
        useDrag.setState({ drop });
      }
    })
    .catch(() => undefined)
    .finally(() => {
      pending = false;
      const next = queued;
      queued = null;
      if (next) {
        moveDrag(next.clientX, next.clientY, next.alt);
      }
    });
};

const resolveDrop = async (
  x: number,
  y: number,
  dragged: Dragged
): Promise<Drop | null> => {
  const except = dragged.kind === "loose" ? dragged.frame : undefined;
  const frameId = frameAt(x, y, except);
  if (!frameId) {
    // A node on the canvas dragged over nothing is only being moved; anything else lands there.
    return dragged.kind === "loose" ? null : { kind: "canvas" };
  }
  return await placementIn(frameId, x, y, dragged);
};

export const cancelDrag = () => useDrag.setState({ dragged: null, drop: null });

const round = (p: { x: number; y: number }) => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
});

/** Selects what a drop left behind: the node where it landed. */
const selectLanded = (drop: Drop, id: string | undefined) => {
  if (!id) {
    return;
  }
  const { docs } = useDocuments.getState();
  const { space } = useEditor.getState();
  const frame =
    drop.kind === "into" && !isNodeFrame(drop.frame)
      ? drop.frame
      : frameOfCanvasNode(docs, space, id);
  if (frame) {
    useEditor.getState().select({ frame, nodeId: id });
  }
};

/** A node on the canvas moved around it, or copied beside itself. */
const moveLoose = async (
  canvas: string,
  node: DesignNode,
  at: { x: number; y: number },
  copy: boolean
) => {
  if (copy) {
    const result = await applyEdits(
      [
        {
          doc: canvas,
          ops: [{ node: { ...node, ...at }, op: "insert", parent: null }],
        },
      ],
      "Copy on the canvas"
    );
    selectLanded({ kind: "canvas" }, result?.created[0]);
    return;
  }
  await applyEdits(
    [{ doc: canvas, ops: [{ id: node.id, op: "update", set: at }] }],
    "Move on the canvas"
  );
};

/** What a drop carries, and the document it leaves (none for a new node). */
const carried = (
  dragged: Dragged,
  created: DesignNode | undefined,
  canvas: string,
  space: string
): { node: DesignNode | null; source: string | null } => {
  if (dragged.kind === "node") {
    return { node: dragged.node, source: docOfFrame(dragged.frame, space) };
  }
  if (dragged.kind === "loose") {
    const { docs } = useDocuments.getState();
    return {
      node: findNode(docs[canvas]?.root, dragged.nodeId),
      source: canvas,
    };
  }
  return { node: created ?? null, source: null };
};

/** The edits a drop makes: an insert, a move within one document, or a move between two. */
const dropEdits = (
  drop: Drop,
  node: DesignNode,
  source: string | null,
  target: string,
  at: { x: number; y: number },
  copy: boolean
): { edits: DocumentEdit[]; label: string } => {
  const parent = drop.kind === "into" ? drop.parent : null;
  const index = drop.kind === "into" ? drop.index : undefined;
  const { x: _x, y: _y, ...unplaced } = node;
  const placed: DesignNode =
    drop.kind === "canvas" ? { ...node, ...at } : (unplaced as DesignNode);
  const insert: DocumentEdit = {
    doc: target,
    ops: [{ index, node: placed, op: "insert", parent }],
  };
  if (source === null) {
    return { edits: [insert], label: "Insert" };
  }
  if (copy) {
    return { edits: [insert], label: "Copy" };
  }
  if (source === target) {
    const moved: DocumentEdit = {
      doc: target,
      ops: [
        { id: node.id, index, op: "move", parent },
        ...(drop.kind === "canvas"
          ? [{ id: node.id, op: "update" as const, set: at }]
          : []),
      ],
    };
    return { edits: [moved], label: "Move" };
  }
  return {
    edits: [{ doc: source, ops: [{ id: node.id, op: "remove" }] }, insert],
    label: drop.kind === "canvas" ? "Move onto the canvas" : "Move",
  };
};

/** Carries the drop out. `created` is the node a palette drag inserts. */
export const endDrag = async (created?: DesignNode) => {
  const { copy, dragged, drop, grab, pointer } = useDrag.getState();
  useDrag.setState({ dragged: null, drop: null });
  const { space } = useEditor.getState();
  if (!dragged || space === null) {
    return;
  }
  const canvas = canvasDocOf(space);
  const at = round({ x: pointer.x - grab.x, y: pointer.y - grab.y });

  if (dragged.kind === "loose" && drop?.kind !== "into") {
    const { docs } = useDocuments.getState();
    const node = findNode(docs[canvas]?.root, dragged.nodeId);
    if (node) {
      await moveLoose(canvas, node, at, copy);
    }
    return;
  }

  const { node, source } = carried(dragged, created, canvas, space);
  if (!(node && drop)) {
    return;
  }
  const target = drop.kind === "into" ? docOfFrame(drop.frame, space) : canvas;
  const { edits, label } = dropEdits(drop, node, source, target, at, copy);
  const result = await applyEdits(edits, label);
  if (result) {
    selectLanded(drop, result.created[0] ?? node.id);
  }
};

/** The frame a node of the canvas lands in, for a selection after a drop. */
export const frameOfNode = (id: string) =>
  frameOfCanvasNode(
    useDocuments.getState().docs,
    useEditor.getState().space,
    id
  ) ?? nodeFrameOf(id);

// ---- Placing something new without a drag ----

/** Where something new put at this canvas point would land. */
export const placementAt = (x: number, y: number) =>
  resolveDrop(x, y, { kind: "new", name: "" });

/**
 * Inserts a new node where `drop` says, `at` being its position when it lands on the canvas, and
 * selects it. Resolves to its id, or null when nothing was inserted.
 */
export const insertAt = async (
  drop: Drop,
  node: DesignNode,
  at: { x: number; y: number }
): Promise<string | null> => {
  const { space } = useEditor.getState();
  if (space === null) {
    return null;
  }
  const canvas = canvasDocOf(space);
  const target = drop.kind === "into" ? docOfFrame(drop.frame, space) : canvas;
  const { edits, label } = dropEdits(
    drop,
    node,
    null,
    target,
    round(at),
    false
  );
  const result = await applyEdits(edits, label);
  const id = result?.created[0] ?? null;
  selectLanded(drop, id ?? undefined);
  return id;
};
