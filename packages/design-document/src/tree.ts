/**
 * Reading a design document's tree: finding a node, the way down to it, its parent, and what
 * the layers panel calls it. Pure and synchronous, shared by the server, the editor and the
 * preview so that all three agree on what a document holds.
 */

import type { ComponentSlot } from "@ultrapaint/contracts/catalogue";
import { componentTakesChildren } from "@ultrapaint/contracts/catalogue";
import type {
  ContainerNode,
  DesignNode,
  GroupNode,
} from "@ultrapaint/contracts/document";

/** File extension of a page, with its dots. */
export const PAGE_EXTENSION = ".page.json";

/** Version of the page format, written into every page file. */
export const DOCUMENT_VERSION = 1;

/** Id of the group that stands for a canvas's loose nodes. */
export const CANVAS_ROOT_ID = "canvas";

const CANVAS_DOC_PREFIX = "canvas:";

/** The document of a canvas's loose nodes, as operations and events name it. */
export const canvasDocOf = (canvas: string): string =>
  `${CANVAS_DOC_PREFIX}${canvas}`;

/** The canvas whose canvas a document is, or null for a page. */
export const canvasOfDoc = (doc: string): string | null =>
  doc.startsWith(CANVAS_DOC_PREFIX)
    ? doc.slice(CANVAS_DOC_PREFIX.length)
    : null;

export const isPageFile = (name: string) => name.endsWith(PAGE_EXTENSION);

/** Nodes that lay out children of their own. An instance holds children too, but as a slot. */
export const isContainer = (node: DesignNode): node is ContainerNode =>
  node.type === "page" ||
  node.type === "group" ||
  node.type === "row" ||
  node.type === "column";

const NO_CHILDREN: readonly DesignNode[] = [];

/** What a node holds: a container's children, an instance's slot, nothing for the rest. */
export const childrenOf = (node: DesignNode): readonly DesignNode[] => {
  if (isContainer(node)) {
    return node.children;
  }
  return node.type === "instance"
    ? (node.children ?? NO_CHILDREN)
    : NO_CHILDREN;
};

/** Whether a node may take children: containers, and instances. */
export const acceptsChildren = (node: DesignNode) =>
  isContainer(node) || node.type === "instance";

/**
 * Whether something may be put inside a node in the editor: a container always, an instance
 * when its component has a default slot (`componentTakesChildren`). Without the component's
 * entry, an instance that already holds nodes is taken at its word.
 */
export const takesChildren = (
  node: DesignNode,
  component:
    | { readonly slots: readonly Pick<ComponentSlot, "holds">[] }
    | undefined
): boolean => {
  if (isContainer(node)) {
    return true;
  }
  if (node.type !== "instance") {
    return false;
  }
  return component
    ? componentTakesChildren(component)
    : (node.children?.length ?? 0) > 0;
};

export const findNode = (
  root: DesignNode | null | undefined,
  id: string
): DesignNode | null => {
  if (!root) {
    return null;
  }
  if (root.id === id) {
    return root;
  }
  for (const child of childrenOf(root)) {
    const found = findNode(child, id);
    if (found) {
      return found;
    }
  }
  return null;
};

/** The nodes from the root down to the one with this id, both included; null if absent. */
export const findPath = (
  root: DesignNode | null | undefined,
  id: string
): DesignNode[] | null => {
  if (!root) {
    return null;
  }
  if (root.id === id) {
    return [root];
  }
  for (const child of childrenOf(root)) {
    const path = findPath(child, id);
    if (path) {
      return [root, ...path];
    }
  }
  return null;
};

/** Every node, depth first, parents before their children. */
export function* walk(root: DesignNode): Generator<DesignNode> {
  yield root;
  for (const child of childrenOf(root)) {
    yield* walk(child);
  }
}

/** Every id the tree uses. */
export const idsOf = (root: DesignNode): Set<string> =>
  new Set(Array.from(walk(root), (node) => node.id));

const shorten = (text: string, max = 32) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const TYPE_LABELS: Record<DesignNode["type"], string> = {
  column: "Column",
  group: "Group",
  image: "Image",
  instance: "Instance",
  page: "Page",
  row: "Row",
  text: "Text",
};

/** What the layers panel calls a node: its name, else what it is and what it says. */
export const nodeLabel = (node: DesignNode): string => {
  if (node.name) {
    return node.name;
  }
  switch (node.type) {
    case "text":
      return shorten(
        node.text.trim() ||
          (node.role === "heading" ? `Heading ${node.level ?? 1}` : "Paragraph")
      );
    case "instance":
      return node.text
        ? `${node.component} "${shorten(node.text, 20)}"`
        : node.component;
    case "image":
      return node.alt ? `Image "${shorten(node.alt, 20)}"` : "Image";
    default:
      return TYPE_LABELS[node.type];
  }
};

/** What kind of thing a node is, in a word: for icons and the inspector's header. */
export const nodeKind = (node: DesignNode): string => {
  if (node.type === "text") {
    return node.role === "heading" ? `Heading ${node.level ?? 1}` : "Paragraph";
  }
  return TYPE_LABELS[node.type];
};

/** The canvas's loose nodes as one tree, which is how operations and the layers see them. */
export const canvasRoot = (nodes: readonly DesignNode[]): GroupNode => ({
  children: nodes,
  id: CANVAS_ROOT_ID,
  type: "group",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether two JSON values are the same value, whatever the order of their keys: a key set to
 * undefined is a key left out, as it is once the value is written as JSON. The one equality of
 * trees, for the editors' patches and the agents' diff alike.
 */
export const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return Array.from(keys).every((key) => sameJson(a[key], b[key]));
  }
  return false;
};

/** A node of a tree with where it sits: its parent's id, null for the root, and its index. */
export interface IndexedNode {
  readonly index: number;
  readonly node: DesignNode;
  readonly parent: string | null;
}

/**
 * Every node of a tree by id with where it sits, in the order a tree is read; `repeated` when an
 * id is there more than once, the first one kept.
 */
export const indexTree = (
  root: DesignNode
): { readonly nodes: Map<string, IndexedNode>; readonly repeated: boolean } => {
  const nodes = new Map<string, IndexedNode>();
  let repeated = false;
  const stack: IndexedNode[] = [{ index: 0, node: root, parent: null }];
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    if (nodes.has(entry.node.id)) {
      repeated = true;
      continue;
    }
    nodes.set(entry.node.id, entry);
    const parent = entry.node.id;
    // Pushed last first, so the nodes come in the order a tree is read.
    stack.push(
      ...childrenOf(entry.node)
        .map((node, index) => ({ index, node, parent }))
        .toReversed()
    );
  }
  return { nodes, repeated };
};

/**
 * `next` with every node that is as it was in `prev` the very node `prev` had, found by id: a
 * document read again keeps the objects of what did not change, so what draws it (memoised by
 * node) draws again only what did. `prev` itself when nothing changed.
 */
export const shareUnchanged = (
  prev: DesignNode | null,
  next: DesignNode | null
): DesignNode | null => {
  if (prev === null || next === null || prev === next) {
    return next;
  }
  const before = new Map(childrenOf(prev).map((c) => [c.id, c]));
  const kids = childrenOf(next);
  let same = kids.length === childrenOf(prev).length && prev.id === next.id;
  const children = kids.map((child, i) => {
    const was = before.get(child.id);
    const shared = was ? (shareUnchanged(was, child) as DesignNode) : child;
    same &&= shared === childrenOf(prev)[i];
    return shared;
  });
  const { children: _p, ...own } = prev as DesignNode & { children?: unknown };
  const { children: _n, ...ownNext } = next as DesignNode & {
    children?: unknown;
  };
  if (
    same &&
    "children" in prev === "children" in next &&
    sameJson(own, ownNext)
  ) {
    return prev;
  }
  return "children" in next ? ({ ...next, children } as DesignNode) : next;
};

/**
 * A tree shown `depth` levels down: a node at the last level shown keeps its fields but not its
 * children, which it counts instead (`childCount`), so a big page is read an outline first and a
 * part at a time after.
 */
export const outlineOf = (node: DesignNode, depth: number): DesignNode => {
  const kids = childrenOf(node);
  if (kids.length === 0) {
    return node;
  }
  if (depth <= 0) {
    const { children: _children, ...own } = node as DesignNode & {
      children?: unknown;
    };
    return { ...own, childCount: kids.length } as unknown as DesignNode;
  }
  return {
    ...node,
    children: kids.map((child) => outlineOf(child, depth - 1)),
  } as DesignNode;
};
