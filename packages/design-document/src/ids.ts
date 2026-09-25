/**
 * Node ids. A document names every node, so that an operation, a selection, a comment and an
 * agent can point at one; a file written by hand or by an agent may leave ids out, and they are
 * filled in when it is read.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { childrenOf, walk } from "./tree.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A short id that does not collide with any of `taken`. */
export const makeIdGenerator = (
  taken: Iterable<string> = [],
  random: () => number = Math.random
) => {
  const used = new Set(taken);
  return (prefix = "n"): string => {
    for (;;) {
      let id = `${prefix}_`;
      for (let i = 0; i < 6; i += 1) {
        id += ALPHABET[Math.floor(random() * ALPHABET.length)];
      }
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
};

export type IdGenerator = ReturnType<typeof makeIdGenerator>;

/** The prefix an id of this type starts with: `t_` for text, `r_` for a row. */
export const idPrefix = (type: string): string => {
  switch (type) {
    case "column":
      return "c";
    case "group":
      return "g";
    case "image":
      return "img";
    case "instance":
      return "i";
    case "row":
      return "r";
    case "text":
      return "t";
    default:
      return "n";
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fills in the ids a raw document leaves out, and replaces those used twice, before it is
 * decoded. Works on untyped JSON: a node is any object with a string `type`. Returns whether
 * anything changed, so the caller can write the ids back.
 */
export const fillIds = (json: unknown): boolean => {
  const nodes: Record<string, unknown>[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        collect(item);
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    if (typeof value.type === "string") {
      nodes.push(value);
    }
    for (const key of ["root", "children", "nodes"]) {
      if (key in value) {
        collect(value[key]);
      }
    }
  };
  collect(json);
  const taken = new Set<string>();
  const missing: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (typeof node.id === "string" && node.id !== "" && !taken.has(node.id)) {
      taken.add(node.id);
    } else {
      missing.push(node);
    }
  }
  const next = makeIdGenerator(taken);
  for (const node of missing) {
    node.id = next(idPrefix(String(node.type)));
  }
  return missing.length > 0;
};

/** A copy of the node with a new id on it and on everything inside it. */
export const withNewIds = (node: DesignNode, next: IdGenerator): DesignNode => {
  const copy = { ...node, id: next(idPrefix(node.type)) } as DesignNode;
  const children = childrenOf(node);
  if (children.length === 0 && !("children" in node)) {
    return copy;
  }
  return {
    ...copy,
    children: children.map((child) => withNewIds(child, next)),
  } as DesignNode;
};

/** Whether any id occurs twice in the tree. */
export const duplicateIds = (root: DesignNode): string[] => {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const node of walk(root)) {
    if (seen.has(node.id)) {
      twice.add(node.id);
    }
    seen.add(node.id);
  }
  return [...twice];
};
