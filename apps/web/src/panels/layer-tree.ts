/**
 * The layers panel's tree as data: its rows, what a filter leaves of them, the rows that can be
 * seen, and where the arrow keys go among those, the way the WAI-ARIA tree pattern has it. Pure,
 * so that it can be read — and tested — without an editor.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { childrenOf, nodeLabel } from "@ultrapaint/design-document/tree";

/** A row of the panel and the rows written under it. */
export interface LayerItem {
  readonly children: readonly LayerItem[];
  /** The frame the row's node is shown in. */
  readonly frame: string;
  readonly key: string;
  /** The node the row names: for a page, its root, null while the page cannot be read. */
  readonly node: DesignNode | null;
  /** The page the row stands for, when it is a page's row. */
  readonly page?: Page;
  /** The node it is inside, or null for the top of a page or of the canvas. */
  readonly parent: DesignNode | null;
}

export const layerKey = (frame: string, nodeId: string) => `${frame}#${nodeId}`;

/** A page's row is keyed by the page, whatever its root is called. */
export const pageKey = (pageId: string) => layerKey(pageId, "page");

const nodeItem = (
  frame: string,
  node: DesignNode,
  parent: DesignNode | null
): LayerItem => ({
  children: childrenOf(node).map((child) => nodeItem(frame, child, node)),
  frame,
  key: layerKey(frame, node.id),
  node,
  parent,
});

/** A page's row: the page, with the nodes of its root under it. */
export const pageItem = (page: Page, root: DesignNode | null): LayerItem => ({
  children: root
    ? childrenOf(root).map((child) => nodeItem(page.id, child, root))
    : [],
  frame: page.id,
  key: pageKey(page.id),
  node: root,
  page,
  parent: null,
});

/** The row of a node placed on the canvas, which is a frame of its own. */
export const looseItem = (frame: string, node: DesignNode): LayerItem =>
  nodeItem(frame, node, null);

/** What a filter is matched against: the name the row shows, and what the node says or is. */
const termsOf = (item: LayerItem): string[] => {
  const { node, page } = item;
  if (page) {
    return [page.name];
  }
  if (!node) {
    return [];
  }
  const terms = [nodeLabel(node), node.name ?? ""];
  if (node.type === "text") {
    terms.push(node.text);
  }
  if (node.type === "instance") {
    terms.push(node.component, node.text ?? "");
  }
  return terms;
};

const matches = (item: LayerItem, query: string) =>
  termsOf(item).some((term) => term.toLowerCase().includes(query));

const narrow = (items: readonly LayerItem[], query: string): LayerItem[] =>
  items.flatMap((item) => {
    const children = narrow(item.children, query);
    return matches(item, query) || children.length > 0
      ? [{ ...item, children }]
      : [];
  });

/**
 * The rows whose name, text or component holds the query, case aside, and the rows they are
 * written under, so that each is still seen where it is; the rest are left out. A row that
 * matches keeps only those of its own rows that match too. An empty query leaves every row.
 */
export const filterLayers = (
  items: readonly LayerItem[],
  query: string
): readonly LayerItem[] => {
  const q = query.trim().toLowerCase();
  return q === "" ? items : narrow(items, q);
};

/** Whether a row shows the rows under it: it has some, and has not been folded. */
export const isExpanded = (item: LayerItem, collapsed: ReadonlySet<string>) =>
  item.children.length > 0 && !collapsed.has(item.key);

/** A row as the keyboard sees it, in the order the panel lists them. */
export interface VisibleRow {
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly key: string;
  /** 1 at the top of the tree, as `aria-level` counts. */
  readonly level: number;
  /** The row it is written under, or null at the top. */
  readonly parent: string | null;
}

/** Every row that can be seen, from top to bottom: the rows of folded ones left out. */
export const visibleRows = (
  items: readonly LayerItem[],
  collapsed: ReadonlySet<string>,
  level = 1,
  parent: string | null = null
): VisibleRow[] =>
  items.flatMap((item) => {
    const expanded = isExpanded(item, collapsed);
    const row: VisibleRow = {
      expandable: item.children.length > 0,
      expanded,
      key: item.key,
      level,
      parent,
    };
    return expanded
      ? [row, ...visibleRows(item.children, collapsed, level + 1, item.key)]
      : [row];
  });

/** What a key does to the tree: move the focus to a row, or open or fold one. */
export type TreeMove =
  | { readonly focus: string }
  | { readonly expand: string }
  | { readonly collapse: string };

/** The keys the tree moves on; the panel keeps them from the canvas, which has its own. */
export const TREE_KEYS: ReadonlySet<string> = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowRight",
  "ArrowLeft",
  "Home",
  "End",
]);

const focusOn = (row: VisibleRow | undefined): TreeMove | null =>
  row ? { focus: row.key } : null;

/**
 * Where a key takes the focus from a row: down and up to the next and the previous row that can
 * be seen; right opens a folded row, then goes to its first row; left folds an open row, then
 * goes up to the row it is under; Home and End go to the first and the last. Null when the key
 * has nowhere to go. A focus on no row that can be seen starts again from the first.
 */
export const treeMove = (
  rows: readonly VisibleRow[],
  current: string | null,
  key: string
): TreeMove | null => {
  const at = rows.findIndex((r) => r.key === current);
  const row = rows[at];
  if (!row) {
    return TREE_KEYS.has(key) ? focusOn(rows[0]) : null;
  }
  switch (key) {
    case "ArrowDown":
      return focusOn(rows[at + 1]);
    case "ArrowUp":
      return focusOn(rows[at - 1]);
    case "Home":
      return focusOn(rows[0]);
    case "End":
      return focusOn(rows.at(-1));
    case "ArrowRight": {
      if (!row.expandable) {
        return null;
      }
      if (!row.expanded) {
        return { expand: row.key };
      }
      const first = rows[at + 1];
      return first?.parent === row.key ? focusOn(first) : null;
    }
    case "ArrowLeft":
      if (row.expanded) {
        return { collapse: row.key };
      }
      return row.parent === null ? null : { focus: row.parent };
    default:
      return null;
  }
};
