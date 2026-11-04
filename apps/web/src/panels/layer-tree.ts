/**
 * The layers panel's tree as data: its rows, what a filter leaves of them, which rows are folded
 * and the ones a selection unfolds, the rows that can be seen, where the arrow keys go among
 * those, the way the WAI-ARIA tree pattern has it, and where a row dragged onto another lands.
 * Pure, so that it can be read — and tested — without an editor; the panel draws it and forwards
 * its events to it.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  childrenOf,
  findPath,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import type { Place } from "../lib/node-actions.ts";

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

/**
 * What Layers lists, and the heading over its first node: an app component edited in place, its
 * tree alone (the rest of the canvas being out of reach); on an app component's board (ADR 0045),
 * its tree; else the canvas's pages, each with its nodes, then the nodes beside the pages.
 * `nodes` are the top nodes listed under the heading.
 */
export const layerScope = ({
  canvasNodes,
  edited,
  pages,
  roots,
  tree,
}: {
  /** The nodes on the canvas beside the pages, each a frame of its own (`frameOf`). */
  readonly canvasNodes: readonly { frame: string; node: DesignNode }[];
  /** The app component edited in place, with its tree once the documents have it. */
  readonly edited: {
    readonly component: string;
    readonly frame: string;
    readonly root: DesignNode | null;
  } | null;
  readonly pages: readonly Page[];
  /** Each page's root, by page id, null while it cannot be read. */
  readonly roots: (pageId: string) => DesignNode | null;
  /** An app component's tree on its board, the board it is selected in and its name. */
  readonly tree: {
    readonly frame: string;
    readonly name: string;
    readonly root: DesignNode;
  } | null;
}): {
  readonly heading: string;
  readonly items: readonly LayerItem[];
  readonly nodes: readonly DesignNode[];
} => {
  if (edited?.root) {
    return {
      heading: `Editing ${edited.component}`,
      items: [looseItem(edited.frame, edited.root)],
      nodes: [edited.root],
    };
  }
  if (tree) {
    return {
      heading: tree.name,
      items: [looseItem(tree.frame, tree.root)],
      nodes: [tree.root],
    };
  }
  return {
    heading: "On the canvas",
    items: [
      ...pages.map((page) => pageItem(page, roots(page.id))),
      ...canvasNodes.map(({ frame, node }) => looseItem(frame, node)),
    ],
    nodes: canvasNodes.map(({ node }) => node),
  };
};

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

/** The rows from the top of the tree down to the one a key names, null when it names none. */
const pathTo = (
  items: readonly LayerItem[],
  key: string
): readonly LayerItem[] | null => {
  for (const item of items) {
    if (item.key === key) {
      return [item];
    }
    const below = pathTo(item.children, key);
    if (below) {
      return [item, ...below];
    }
  }
  return null;
};

/** The row a key names, wherever it is in the tree. */
export const findItem = (
  items: readonly LayerItem[],
  key: string
): LayerItem | null => pathTo(items, key)?.at(-1) ?? null;

/** Whether a row is open, showing the rows under it when it has some. */
type IsOpen = (item: LayerItem) => boolean;

/** Every row open but the folded ones: how what a filter finds starts out. */
export const openUnless =
  (folded: ReadonlySet<string>): IsOpen =>
  (item) =>
    !folded.has(item.key);

/** The pages open and the layers in them folded, but for the rows flipped from that. */
const pagesOpen =
  (flipped: ReadonlySet<string>): IsOpen =>
  (item) =>
    (item.page !== undefined) !== flipped.has(item.key);

/**
 * Which rows are folded. The panel starts out with the pages open and the layers in them folded,
 * the way Figma lists the top layers of each frame, so that a canvas of thousands of layers lists
 * a few dozen rows until one is opened; `flipped` holds the rows opened or folded against that.
 * What a filter finds starts out open instead, every row of it in sight, and `foldedInFilter`
 * holds the rows folded among it until the filter changes. The filter typed is part of it, as it
 * says which of the two the rows fold by.
 */
export interface Folds {
  readonly flipped: ReadonlySet<string>;
  readonly foldedInFilter: ReadonlySet<string>;
  /** What is typed into the filter, as it is typed. */
  readonly query: string;
}

/** How the panel starts out: no filter, and nothing flipped. */
export const NO_FOLDS: Folds = {
  flipped: new Set(),
  foldedInFilter: new Set(),
  query: "",
};

const filtering = (folds: Folds) => folds.query.trim() !== "";

/** Whether a row is open, by the folds: the filter's while one is typed, else the panel's own. */
export const isOpenIn = (folds: Folds): IsOpen =>
  filtering(folds)
    ? openUnless(folds.foldedInFilter)
    : pagesOpen(folds.flipped);

/** The folds with another filter typed: what it finds all starts out open. */
export const withQuery = (folds: Folds, query: string): Folds => ({
  ...folds,
  foldedInFilter: new Set(),
  query,
});

/** Opens or folds each of the rows, from whichever way it is now. */
export const flip = (folds: Folds, keys: readonly string[]): Folds => {
  const inFilter = filtering(folds);
  const next = new Set(inFilter ? folds.foldedInFilter : folds.flipped);
  for (const key of keys) {
    if (!next.delete(key)) {
      next.add(key);
    }
  }
  return inFilter
    ? { ...folds, foldedInFilter: next }
    : { ...folds, flipped: next };
};

const sameKeys = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/**
 * The folds with the way down to a row open, the filter's as the panel's, so that it can be
 * seen: the rows it is written under, its page among them, but not the row itself. The same
 * folds when they were open already, or the key names no row.
 */
export const revealed = (
  folds: Folds,
  items: readonly LayerItem[],
  key: string
): Folds => {
  const above = pathTo(items, key)?.slice(0, -1) ?? [];
  const flipped = new Set(folds.flipped);
  const foldedInFilter = new Set(folds.foldedInFilter);
  for (const item of above) {
    // A page opens by default, a layer when flipped.
    if (item.page) {
      flipped.delete(item.key);
    } else {
      flipped.add(item.key);
    }
    foldedInFilter.delete(item.key);
  }
  return sameKeys(flipped, folds.flipped) &&
    sameKeys(foldedInFilter, folds.foldedInFilter)
    ? folds
    : { ...folds, flipped, foldedInFilter };
};

/** Whether a row shows the rows under it: it has some, and is open. */
const isExpanded = (item: LayerItem, isOpen: IsOpen) =>
  item.children.length > 0 && isOpen(item);

/** A row as the panel lists it, in the order it lists them. */
export interface VisibleRow {
  readonly expandable: boolean;
  readonly expanded: boolean;
  /** The rows it is written under, outermost first: the panel draws a guide line for each. */
  readonly guides: readonly string[];
  /** A row it is written under is hidden, and this one with it. */
  readonly hiddenAbove: boolean;
  readonly item: LayerItem;
  readonly key: string;
  /** 1 at the top of the tree, as `aria-level` counts. */
  readonly level: number;
  /** The row it is written under, or null at the top. */
  readonly parent: string | null;
  /** Its place among the rows under the same one, from 1, as `aria-posinset` counts. */
  readonly position: number;
  /** How many rows are under the same one, as `aria-setsize` counts. */
  readonly siblings: number;
}

/** Every row that can be seen, from top to bottom: the rows of folded ones left out. */
export const visibleRows = (
  items: readonly LayerItem[],
  isOpen: IsOpen,
  level = 1,
  parent: string | null = null,
  guides: readonly string[] = [],
  hiddenAbove = false
): VisibleRow[] =>
  items.flatMap((item, index) => {
    const expanded = isExpanded(item, isOpen);
    const row: VisibleRow = {
      expandable: item.children.length > 0,
      expanded,
      guides,
      hiddenAbove,
      item,
      key: item.key,
      level,
      parent,
      position: index + 1,
      siblings: items.length,
    };
    if (!expanded) {
      return [row];
    }
    // A page's root is the page: hiding it hides nothing in the list.
    const hidden =
      hiddenAbove || (item.page === undefined && item.node?.hidden === true);
    return [
      row,
      ...visibleRows(
        item.children,
        isOpen,
        level + 1,
        item.key,
        [...guides, item.key],
        hidden
      ),
    ];
  });

/** What a key does to the tree: move the focus to a row, or open or fold one. */
type TreeMove =
  | { readonly focus: string }
  | { readonly expand: string }
  | { readonly collapse: string };

/** The keys the tree moves on; the panel keeps them from the canvas, which has its own. */
const TREE_KEYS: ReadonlySet<string> = new Set([
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

/**
 * The rows Collapse all folds: every open row seen, the pages among them, so the panel comes back
 * to the list of its pages. The pages start out open, so there is something to fold from the start.
 */
export const openRows = (rows: readonly VisibleRow[]): string[] =>
  rows.filter((r) => r.expanded).map((r) => r.key);

/**
 * Whether the row at `index` starts a group of its own: a page's row under the rows of the page
 * before it, or under a page that draws something beneath its row (`hasBody`: an invalid page's
 * message), so each page and what is under it read as one group.
 */
export const startsPageGroup = (
  rows: readonly VisibleRow[],
  index: number,
  hasBody: (row: VisibleRow) => boolean = () => false
): boolean => {
  const before = rows[index - 1];
  return (
    rows[index]?.item.page !== undefined &&
    before !== undefined &&
    (before.item.page === undefined || hasBody(before))
  );
};

/** Where a row dragged over another lands: just above it, inside it at the top, or just below. */
export type DropPosition = "before" | "inside" | "after";

/**
 * Whether a dragged row may land on another: a node's row, onto a page or another node's row,
 * not onto itself or anything inside it.
 */
const mayDrop = (dragged: LayerItem, over: LayerItem) => {
  const { node } = dragged;
  if (dragged.page || !(node && over.node)) {
    return false;
  }
  if (over.page) {
    return true;
  }
  return !(
    node.id === over.node.id ||
    (dragged.frame === over.frame && findPath(node, over.node.id) !== null)
  );
};

/**
 * Where a dragged row would land on another, the pointer `y` of the way down it (0 at its top, 1
 * at its bottom): inside a node that `holds` children while over the middle of its row, else
 * before or after it by the half the pointer is over; inside a page wherever over its row. Null
 * where it may not land.
 */
export const dropPositionAt = (
  dragged: LayerItem,
  over: LayerItem,
  y: number,
  holds: (node: DesignNode) => boolean
): DropPosition | null => {
  if (!(mayDrop(dragged, over) && over.node)) {
    return null;
  }
  if (over.page || (holds(over.node) && y > 0.3 && y < 0.7)) {
    return "inside";
  }
  return y <= 0.5 ? "before" : "after";
};

/** Where among its siblings a dropped layer goes, the dragged one left out. */
const dropIndex = (
  siblings: readonly DesignNode[],
  dragged: string,
  over: string,
  position: DropPosition
) => {
  if (position === "inside") {
    return 0;
  }
  const at = siblings
    .filter((c) => c.id !== dragged)
    .findIndex((c) => c.id === over);
  return position === "before" ? at : at + 1;
};

/** How far below the node on the canvas it is dropped beside a layer lands. */
const BELOW = 40;

/**
 * Where a row dropped on another lands, as node-actions places it: before or after it among its
 * siblings, the dragged one left out, or inside it at the top, across documents too. Beside a
 * node on the canvas it goes onto the canvas, at that place among its nodes; one that was not on
 * the canvas's top level, which has no point there, lands just below that node. `editedIn` names
 * the frame an edit to a row's node is made in: a page's row stands for every view of it
 * (ADR 0036). Null where the row may not land.
 */
export const dropOf = (
  items: readonly LayerItem[],
  dragged: LayerItem,
  over: LayerItem,
  position: DropPosition,
  editedIn: (frame: string) => string = (frame) => frame
): Place | null => {
  const { node } = dragged;
  const target = over.node;
  if (
    !(mayDrop(dragged, over) && node && target) ||
    (over.page && position !== "inside")
  ) {
    return null;
  }
  const into = position === "inside" ? target : over.parent;
  const onCanvas = items.flatMap((item) =>
    item.page || !item.node ? [] : [item.node]
  );
  const index = dropIndex(
    into ? childrenOf(into) : onCanvas,
    node.id,
    target.id,
    position
  );
  if (into) {
    return {
      frame: editedIn(over.frame),
      index,
      kind: "into",
      parent: into.id,
    };
  }
  return {
    ...(dragged.parent !== null && {
      at: { x: target.x ?? 0, y: (target.y ?? 0) + BELOW },
    }),
    index,
    kind: "canvas",
  };
};
