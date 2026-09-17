/**
 * Reading the tree the preview sends: the rows the layers panel shows, the path to a node, and
 * which node a click on the canvas takes. Pure functions over `TreeNode`, kept out of the store
 * so that they can be read — and tested — without a connection to the server.
 */
import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { TreeNode } from "@ultrapaint/contracts/preview";

/** Finds a node by id. */
export const findNode = (
  tree: TreeNode | undefined,
  id: string
): TreeNode | null => {
  if (!tree) {
    return null;
  }
  if (tree.id === id) {
    return tree;
  }
  for (const c of tree.children) {
    const r = findNode(c, id);
    if (r) {
      return r;
    }
  }
  return null;
};

/**
 * The element a component renders as its only child. The layers panel shows the two on one row,
 * so navigation treats them as one node.
 */
export const hostOf = (node: TreeNode | undefined): TreeNode | null => {
  const only = node?.children[0];
  return node?.kind === "component" &&
    node.children.length === 1 &&
    only?.kind === "element"
    ? only
    : null;
};

/** Children as the layers panel shows them: a component's host element is skipped. */
export const rowChildren = (node: TreeNode): readonly TreeNode[] =>
  (hostOf(node) ?? node).children;

/** Finds a node by id in a tree, returning the path of ancestors. */
export const findPath = (
  tree: TreeNode | undefined,
  id: string
): TreeNode[] | null => {
  if (!tree) {
    return null;
  }
  const walk = (node: TreeNode, path: TreeNode[]): TreeNode[] | null => {
    const next = [...path, node];
    if (node.id === id) {
      return next;
    }
    for (const c of node.children) {
      const r = walk(c, next);
      if (r) {
        return r;
      }
    }
    return null;
  };
  return walk(tree, []);
};

/**
 * The chain as the layers panel lists it: a component and the element it renders as its only
 * child share a row there, so they are one step of the way in here. Nothing else is merged —
 * two nodes laid out exactly alike are still two nodes, and one the panel lists has to be
 * reachable on the canvas too.
 */
const asRows = (
  chain: readonly string[],
  tree: TreeNode | undefined
): string[] => {
  const rows: string[] = [];
  for (const id of chain) {
    const above = rows.at(-1);
    if (above && hostOf(findNode(tree, above) ?? undefined)?.id === id) {
      continue;
    }
    rows.push(id);
  }
  return rows;
};

/**
 * Which node under the pointer a click takes, and what a hover therefore shows.
 *
 * The first of the chain is the one the preview offers: an instance of the design system whole,
 * a popup as the box it draws. Clicking what is already selected goes one step further in, the
 * way entering a group does on a canvas, so the parts of a menu are reached by clicking them
 * again rather than by hunting for them in the layers panel. The step is measured from the
 * deepest node of the chain the selection already sits under, not from the selection itself:
 * having opened one item of a list, pointing at its neighbour offers that neighbour and not the
 * list again. Alt goes straight to the innermost part.
 */
export const stepInto = (
  chain: readonly string[],
  tree: TreeNode | undefined,
  selectedId: string | null,
  alt: boolean
): string | null => {
  const rows = asRows(chain, tree);
  const last = rows.at(-1) ?? null;
  if (alt || rows.length < 2) {
    return last;
  }
  const open = new Set(
    (selectedId ? findPath(tree, selectedId) : null)?.map((n) => n.id)
  );
  let depth = -1;
  rows.forEach((id, i) => {
    if (open.has(id)) {
      depth = i;
    }
  });
  return rows[Math.min(depth + 1, rows.length - 1)] ?? last;
};

export const findBySource = (
  tree: TreeNode | undefined,
  source: SourceLocation,
  preferKind?: TreeNode["kind"]
): TreeNode | null => {
  if (!tree) {
    return null;
  }
  let fallback: TreeNode | null = null;
  const walk = (node: TreeNode): TreeNode | null => {
    if (
      node.source &&
      node.source.file === source.file &&
      node.source.line === source.line &&
      node.source.col === source.col
    ) {
      if (!preferKind || node.kind === preferKind) {
        return node;
      }
      fallback ??= node;
    }
    for (const c of node.children) {
      const r = walk(c);
      if (r) {
        return r;
      }
    }
    return null;
  };
  return walk(tree) ?? fallback;
};
