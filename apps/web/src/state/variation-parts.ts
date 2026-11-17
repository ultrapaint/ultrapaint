/**
 * One part of a variation put in the preview (ADR 0098): **Use in preview** replaces the
 * preview's part with that id; **Add to preview** puts a part the preview lacks in the same place
 * in its parent. Either way, a node of the preview whose id the part also holds moves into the
 * part, where the variation has it, so each id stays in one place. Pure: the trees in, the tree
 * the preview draws out.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  childrenOf,
  findNode,
  findPath,
  idsOf,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";

const LEVEL_RE = / \d+$/;

/** The kinds of node that hold others: a part is added to one of them only. */
const HOLDERS: ReadonlySet<DesignNode["type"]> = new Set([
  "page",
  "row",
  "column",
  "group",
]);

/** What putting a part in the preview gives: the tree it draws, or why it cannot. */
export type PartPut =
  | {
      readonly how: "use" | "add";
      readonly tree: DesignNode;
      readonly why?: undefined;
    }
  | { readonly how: "none"; readonly tree: null; readonly why: string };

/** The node with these children. */
const withChildren = (
  node: DesignNode,
  children: readonly DesignNode[]
): DesignNode => ({ ...node, children }) as DesignNode;

/** The tree without the nodes of these ids, wherever they are; the root is always kept. */
const without = (root: DesignNode, ids: ReadonlySet<string>): DesignNode => {
  const children = childrenOf(root);
  if (children.length === 0) {
    return root;
  }
  return withChildren(
    root,
    children.filter((c) => !ids.has(c.id)).map((c) => without(c, ids))
  );
};

/** A tree with `part` in place of the node with its id; the same tree when it has none. */
export const drawnWith = (root: DesignNode, part: DesignNode): DesignNode => {
  if (root.id === part.id) {
    return part;
  }
  const children = childrenOf(root);
  if (children.length === 0) {
    return root;
  }
  const next = children.map((child) => drawnWith(child, part));
  return next.every((child, i) => child === children[i])
    ? root
    : withChildren(root, next);
};

/** The tree with `part` inserted at `index` among the children of `parent`. */
const inserted = (
  root: DesignNode,
  parent: string,
  index: number,
  part: DesignNode
): DesignNode => {
  const children = childrenOf(root);
  if (root.id === parent) {
    const at = Math.min(index, children.length);
    return withChildren(root, [
      ...children.slice(0, at),
      part,
      ...children.slice(at),
    ]);
  }
  return children.length === 0
    ? root
    : withChildren(
        root,
        children.map((c) => inserted(c, parent, index, part))
      );
};

/**
 * The preview with the part of `variation` whose id is `id`: in use where the preview has that
 * id, added in its parent where it has the parent, else nothing and why.
 */
export const putPart = (
  preview: DesignNode,
  variation: DesignNode,
  id: string
): PartPut => {
  const path = findPath(variation, id);
  const part = path?.at(-1);
  if (!(path && part)) {
    return { how: "none", tree: null, why: "The variation has no such part" };
  }
  // Each id in one place: what the part holds leaves where the preview has it, and where the
  // part goes is looked for in what is left (the variations may nest them the other way round).
  const held = idsOf(part);
  held.delete(part.id);
  const left = without(preview, held);
  if (findNode(left, id)) {
    return { how: "use", tree: drawnWith(left, part) };
  }
  const parent = path.at(-2);
  const there = parent ? findNode(left, parent.id) : null;
  if (!(parent && there)) {
    return {
      how: "none",
      tree: null,
      why: `The preview has no ${parent ? nodeLabel(parent) : "place"} to put it in`,
    };
  }
  // The preview may draw the parent's id as a node that holds nothing: a text where it was a column.
  if (!HOLDERS.has(there.type)) {
    return {
      how: "none",
      tree: null,
      why: `The preview's ${nodeLabel(there)} holds no parts`,
    };
  }
  const index = childrenOf(parent).findIndex((c) => c.id === id);
  return { how: "add", tree: inserted(left, parent.id, index, part) };
};

/** What a part is called in what the preview is made of: its name, else its kind, in lower case. */
const partWord = (node: DesignNode): string => {
  if (node.name) {
    return node.name.charAt(0).toLowerCase() + node.name.slice(1);
  }
  // Its kind as the layers say it, without a heading's level: "heading", "paragraph", "image".
  return nodeKind(node).toLowerCase().replace(LEVEL_RE, "");
};

/** What the preview is made of: "Original with Editorial's heading and Loud's picture". */
/** A part as what the preview is made of names it: its node, and its variation's name. */
export interface NamedPart {
  readonly node: DesignNode;
  readonly variationName: string;
}

export const mixName = (base: string, parts: readonly NamedPart[]): string => {
  if (parts.length === 0) {
    return base;
  }
  // Each variation's parts said once: "Editorial's heading and texts".
  const byVariation = new Map<string, Map<string, number>>();
  for (const { node, variationName: variation } of parts) {
    const words = byVariation.get(variation) ?? new Map<string, number>();
    const word = partWord(node);
    words.set(word, (words.get(word) ?? 0) + 1);
    byVariation.set(variation, words);
  }
  const phrases = [...byVariation].map(
    ([variation, words]) =>
      `${variation}'s ${[...words].map(([word, n]) => (n > 1 ? `${word}s` : word)).join(" and ")}`
  );
  return `${base} with ${phrases.join(" and ")}`;
};
