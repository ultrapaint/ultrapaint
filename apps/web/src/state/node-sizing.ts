/**
 * An element inside a page drawn at the size its corner is dragged to, before its document has it
 * (ADR 0086): the frame draws the page with that size while the pointer moves, and keeps it once
 * let go until the document says the same. One element per frame at a time.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { childrenOf } from "@ultrapaint/design-document/tree";
import { create } from "zustand";

export interface HeldSize {
  readonly height: number;
  readonly nodeId: string;
  readonly width: number;
}

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

/** The tree with the held element at its held size; the same tree when it is not in it. */
export const withHeldSize = (
  root: DesignNode,
  held: HeldSize | undefined
): DesignNode => {
  if (!held) {
    return root;
  }
  const visit = (node: DesignNode): DesignNode => {
    if (node.id === held.nodeId) {
      return { ...node, height: held.height, width: held.width } as DesignNode;
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
