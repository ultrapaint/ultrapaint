/**
 * An element inside a page drawn at the size its corner is dragged to (ADR 0086), or a stack at
 * the gap or padding its band is dragged to (ADR 0145), before its document has it: the frame
 * draws the page with it while the pointer moves, and keeps it once let go until the document
 * says the same. One element per frame at a time.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { instanceLayerOf } from "@ultrapaint/design-document/instance-layers";
import { applyOps } from "@ultrapaint/design-document/ops";
import { childrenOf, findNode } from "@ultrapaint/design-document/tree";
import { create } from "zustand";

/** What an element is held at: its size, or a stack's spacing, each left as it is when absent. */
export interface HeldSize {
  readonly gap?: JsonValue | undefined;
  readonly height?: number | undefined;
  readonly nodeId: string;
  readonly padding?: JsonValue | undefined;
  readonly width?: number | undefined;
}

/** The fields a held element is drawn with. */
const heldFields = ({ nodeId: _id, ...held }: HeldSize) =>
  Object.fromEntries(
    Object.entries(held).filter(([, value]) => value !== undefined)
  ) as Record<string, JsonValue>;

export const useHeldSizes = create<{ byFrame: Record<string, HeldSize> }>(
  () => ({ byFrame: {} })
);

/** Draws `size`'s element of a frame at its size; null leaves it to its document. */
export const holdSize = (frame: string, size: HeldSize | null) =>
  useHeldSizes.setState((s) => {
    if (size) {
      return { byFrame: { ...s.byFrame, [frame]: size } };
    }
    if (!(frame in s.byFrame)) {
      return s;
    }
    const { [frame]: _released, ...byFrame } = s.byFrame;
    return { byFrame };
  });

/**
 * Keeps an element at `size` while `commit` takes it to its document, then leaves it to the
 * document; a later hold of the same frame outlives this one.
 */
export const holdSizeUntil = async <T>(
  frame: string,
  size: HeldSize,
  commit: () => Promise<T>
): Promise<T> => {
  const held = { ...size };
  holdSize(frame, held);
  try {
    return await commit();
  } finally {
    if (useHeldSizes.getState().byFrame[frame] === held) {
      holdSize(frame, null);
    }
  }
};

/**
 * A layer of an instance drawn with `set` as the instance's override of it (ADR 0114), as the
 * edit that saves it writes it; the tree as it is when the page no longer has the instance.
 */
const withLayerHeld = (
  root: DesignNode,
  layerId: string,
  set: Record<string, JsonValue>
): DesignNode => {
  const layer = instanceLayerOf(layerId);
  if (!(layer && findNode(root, layer.instance))) {
    return root;
  }
  return applyOps(root, [{ id: layerId, op: "update", set }], {
    canvas: false,
    next: () => layerId,
  }).root;
};

/** The tree with the held element at its held size; the same tree when it is not in it. */
export const withHeldSize = (
  root: DesignNode,
  held: HeldSize | undefined
): DesignNode => {
  if (!held) {
    return root;
  }
  const set = heldFields(held);
  if (instanceLayerOf(held.nodeId) && !findNode(root, held.nodeId)) {
    return withLayerHeld(root, held.nodeId, set);
  }
  const visit = (node: DesignNode): DesignNode => {
    if (node.id === held.nodeId) {
      return { ...node, ...set } as DesignNode;
    }
    const children = childrenOf(node);
    if (children.length === 0) {
      return node;
    }
    const next = children.map(visit);
    return next.every((c, i) => c === children[i])
      ? node
      : ({ ...node, children: next } as DesignNode);
  };
  return visit(root);
};
