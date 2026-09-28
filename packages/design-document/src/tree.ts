/**
 * Reading a design document's tree: finding a node, the way down to it, its parent, and what
 * the layers panel calls it. Pure and synchronous, shared by the server, the editor and the
 * preview so that all three agree on what a document holds.
 */
import type {
  ContainerNode,
  DesignNode,
  GroupNode,
  PageNode,
} from "@ultrapaint/contracts/document";

/** File extension of a page, with its dots. */
export const PAGE_EXTENSION = ".page.json";

/** Version of the page format, written into every page file. */
export const DOCUMENT_VERSION = 1;

/** Id of the group that stands for a canvas's loose nodes. */
export const CANVAS_ROOT_ID = "canvas";

const CANVAS_DOC_PREFIX = "canvas:";

/** The document of a space's canvas, as operations and events name it. */
export const canvasDocOf = (space: string): string =>
  `${CANVAS_DOC_PREFIX}${space}`;

/** The space whose canvas a document is, or null for a page. */
export const spaceOfCanvasDoc = (doc: string): string | null =>
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

/** What the catalogue says of a component that decides whether it takes children. */
export interface ChildrenShape {
  readonly props?: readonly { readonly name: string }[];
}

/** Whether a component renders what it is given as children: it declares a `children` prop. */
export const componentTakesChildren = (component: ChildrenShape) =>
  (component.props ?? []).some((p) => p.name === "children");

/**
 * Whether something may be put inside a node in the editor: a container always, an instance
 * when its component takes children. Without the component's entry, an instance that already
 * holds nodes is taken at its word.
 */
export const takesChildren = (
  node: DesignNode,
  component: ChildrenShape | undefined
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

export const parentOf = (
  root: DesignNode | null | undefined,
  id: string
): DesignNode | null => findPath(root, id)?.at(-2) ?? null;

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

/** The modules a tree's instances import, which the preview has to be able to load. */
export const importsOf = (root: DesignNode): Set<string> => {
  const froms = new Set<string>();
  for (const node of walk(root)) {
    if (node.type === "instance") {
      froms.add(node.from);
    }
  }
  return froms;
};

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

export const emptyPage = (): PageNode => ({
  children: [],
  id: "root",
  type: "page",
});
