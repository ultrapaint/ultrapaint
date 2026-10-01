/**
 * Which node a click on the canvas takes, given what is selected and what is locked. Pure, over
 * the ids the preview answers a hit test with, so that it can be read — and tested — without a
 * preview.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { findPath, walk } from "@ultrapaint/design-document/tree";

/**
 * The first of the chain is the outermost node under the pointer, the root of the frame left
 * out. Clicking what is already selected goes one step further in, the way entering a group
 * does on a canvas, so the parts of a row are reached by clicking them again rather than by
 * hunting for them in the layers panel. The step is measured from the deepest node of the chain
 * the selection already sits under, not from the selection itself: having opened one item of a
 * list, pointing at its neighbour offers that neighbour and not the list again. Alt goes
 * straight to the innermost node.
 */
export const stepInto = (
  chain: readonly string[],
  root: DesignNode | null | undefined,
  selectedId: string | null,
  alt: boolean
): string | null => {
  const rows =
    root && chain[0] === root.id && root.type === "page"
      ? chain.slice(1)
      : [...chain];
  const last = rows.at(-1) ?? null;
  if (alt || rows.length < 2) {
    return last;
  }
  const open = new Set(
    (selectedId ? findPath(root, selectedId) : null)?.map((n) => n.id)
  );
  let depth = -1;
  rows.forEach((id, i) => {
    if (open.has(id)) {
      depth = i;
    }
  });
  return rows[Math.min(depth + 1, rows.length - 1)] ?? last;
};

/**
 * The chain a hit test answered with, cut short at the first locked node: a locked node, and
 * everything inside it, is not there for the pointer, which reaches the nearest ancestor that is
 * not locked instead, or nothing at all when the frame's own root is locked.
 */
export const unlockedChain = (
  chain: readonly string[],
  root: DesignNode | null | undefined
): readonly string[] => {
  if (!root) {
    return chain;
  }
  const locked = new Set<string>();
  for (const node of walk(root)) {
    if (node.locked) {
      locked.add(node.id);
    }
  }
  const at = chain.findIndex((id) => locked.has(id));
  return at === -1 ? chain : chain.slice(0, at);
};
