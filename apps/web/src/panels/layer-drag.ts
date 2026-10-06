/**
 * Rows of the layers panel dragged onto each other: where a dragged layer would land, kept in a
 * store of its own, and the edits that move it there, inside a document or from one to another.
 */
import type { DesignNode, DocumentEdit } from "@ultrapaint/contracts/document";
import { findPath } from "@ultrapaint/design-document/tree";
import type { DragEvent } from "react";
import { create } from "zustand";
import { holdsChildren } from "../state/catalogue.ts";
import type { Row, Shared } from "./layers.tsx";

const LAYERS_MIME = "application/ultrapaint-layer";

export type DropPosition = "before" | "inside" | "after";

interface DropTarget {
  key: string;
  position: DropPosition;
}

/**
 * The row a dragged layer would land on, and where. Kept out of the panel's state: a drag-over
 * fires many times a second, and only the rows it leaves and reaches have anything to redraw.
 */
const useLayerDrop = create<{ target: DropTarget | null }>(() => ({
  target: null,
}));

export const setDropTarget = (
  next: DropTarget | null | ((d: DropTarget | null) => DropTarget | null)
) =>
  useLayerDrop.setState((s) => {
    const target = typeof next === "function" ? next(s.target) : next;
    return target?.key === s.target?.key &&
      target?.position === s.target?.position
      ? s
      : { target };
  });

/** Where a dragged layer would land on this row, if it is the one. */
export const useDropHere = (key: string) =>
  useLayerDrop((s) => (s.target?.key === key ? s.target.position : null));

/** Where among its siblings a dropped layer goes, the dragged one left out. */
export const dropIndex = (
  siblings: readonly DesignNode[],
  dragged: string,
  target: string,
  position: DropPosition
) => {
  if (position === "inside") {
    return 0;
  }
  const at = siblings
    .filter((c) => c.id !== dragged)
    .findIndex((c) => c.id === target);
  return position === "before" ? at : at + 1;
};

/** A move within one document, or out of one into another. */
export const layerMoveEdits = (move: {
  destination: string;
  index: number;
  node: DesignNode;
  /** The container it goes into; null for the top of the canvas. */
  parent: string | null;
  source: string;
  /** The layer it was dropped at. */
  target: DesignNode;
}): DocumentEdit[] => {
  const { destination, index, node, parent, source, target } = move;
  if (source === destination) {
    return [{ doc: source, ops: [{ id: node.id, index, op: "move", parent }] }];
  }
  // Onto the canvas beside another node on it: just below that one.
  const placed =
    parent === null
      ? { ...node, x: target.x ?? 0, y: (target.y ?? 0) + 40 }
      : node;
  return [
    { doc: source, ops: [{ id: node.id, op: "remove" }] },
    { doc: destination, ops: [{ index, node: placed, op: "insert", parent }] },
  ];
};

const dropPositionAt = (node: DesignNode, y: number): DropPosition => {
  if (holdsChildren(node) && y > 0.3 && y < 0.7) {
    return "inside";
  }
  return y <= 0.5 ? "before" : "after";
};

/**
 * What a node's row does while a row is dragged: it is picked up, and the dragged one is dropped
 * before it, after it or into it.
 */
export const rowDrag = (row: Row, key: string, shared: Shared) => {
  const { frame, node } = row;
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const dragged = shared.drag;
    if (!dragged || dragged.node.id === node.id) {
      return;
    }
    // Not into itself or anything inside it.
    if (dragged.frame === frame && findPath(dragged.node, node.id) !== null) {
      return;
    }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    setDropTarget({ key, position: dropPositionAt(node, y) });
  };
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    shared.setDrag(row);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(LAYERS_MIME, node.id);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = useLayerDrop.getState().target;
    setDropTarget(null);
    if (t?.key === key) {
      shared.onDrop(row, t.position);
    }
    shared.setDrag(null);
  };
  return {
    onDragEnd: () => {
      shared.setDrag(null);
      setDropTarget(null);
    },
    onDragLeave: () => setDropTarget((d) => (d?.key === key ? null : d)),
    onDragOver,
    onDragStart,
    onDrop,
  };
};
