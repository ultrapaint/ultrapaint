/**
 * Rows of the layers panel dragged onto each other: the drag events read into where a dragged
 * layer would land (`dropPositionAt`), kept in a store of its own, and the drop handed to the
 * panel.
 */
import type { DragEvent } from "react";
import { create } from "zustand";
import { holdsChildren } from "../state/catalogue.ts";
import {
  type DropPosition,
  dropPositionAt,
  type LayerItem,
} from "./layer-tree.ts";

const LAYERS_MIME = "application/ultrapaint-layer";

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

const setDropTarget = (
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

/** What the rows share while one is dragged: the row picked up, and what a drop on a row does. */
export interface Dragging {
  drag: LayerItem | null;
  onDrop: (over: LayerItem, position: DropPosition) => Promise<void>;
  setDrag: (item: LayerItem | null) => void;
}

/** What a row does while another is dragged over it: it says where that one would land, and takes it. */
export const rowDrop = (item: LayerItem, dragging: Dragging) => {
  const { key } = item;
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dragging.drag) {
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const position = dropPositionAt(dragging.drag, item, y, holdsChildren);
    if (position) {
      e.preventDefault();
      setDropTarget({ key, position });
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = useLayerDrop.getState().target;
    setDropTarget(null);
    if (t?.key === key) {
      dragging.onDrop(item, t.position);
    }
    dragging.setDrag(null);
  };
  return {
    onDragLeave: () => setDropTarget((d) => (d?.key === key ? null : d)),
    onDragOver,
    onDrop,
  };
};

/** What a node's row does while a row is dragged: it is picked up, and takes the dragged one. */
export const rowDrag = (item: LayerItem, dragging: Dragging) => ({
  ...rowDrop(item, dragging),
  onDragEnd: () => {
    dragging.setDrag(null);
    setDropTarget(null);
  },
  onDragStart: (e: DragEvent<HTMLDivElement>) => {
    dragging.setDrag(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(LAYERS_MIME, item.node?.id ?? item.key);
  },
});
