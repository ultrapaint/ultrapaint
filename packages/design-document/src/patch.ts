/**
 * A document's change as its changed nodes (ADR 0044): the server sends the editor the nodes an
 * edit made new or changed instead of the whole tree, and the editor puts them into its copy,
 * every node that did not change kept as the object it was, so what draws it draws again only
 * what changed. A node is found by its id, which a document holds once.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ChangedNode, DesignNode } from "@ultrapaint/contracts/document";
import { childrenOf, sameJson } from "./tree.ts";

/** A node's fields but its children. */
const ownOf = (node: DesignNode): Record<string, JsonValue> => {
  const { children: _children, ...own } = node as DesignNode & {
    children?: unknown;
  };
  return own as Record<string, JsonValue>;
};

const holds = (node: DesignNode) => "children" in node;

/** Every node of a tree by id; null when an id is there twice. */
const byId = (root: DesignNode): Map<string, DesignNode> | null => {
  const nodes = new Map<string, DesignNode>();
  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (nodes.has(node.id)) {
      return null;
    }
    nodes.set(node.id, node);
    // Pushed last first, so the nodes come in the order a tree is read.
    stack.push(...childrenOf(node).toReversed());
  }
  return nodes;
};

const sameIds = (a: readonly DesignNode[], b: readonly DesignNode[]) =>
  a.length === b.length && a.every((n, i) => n.id === b[i]?.id);

/**
 * The nodes of `next` that are new or changed since `prev`, in their own fields or in the
 * children they hold, each with its children by id; null when they cannot say it, because an id
 * is there twice, or because they would say about as much as the whole tree does.
 */
export const changedNodes = (
  prev: DesignNode,
  next: DesignNode
): ChangedNode[] | null => {
  const before = byId(prev);
  const after = byId(next);
  if (!(before && after)) {
    return null;
  }
  const changed: ChangedNode[] = [];
  for (const node of after.values()) {
    const was = before.get(node.id);
    const kids = childrenOf(node);
    if (
      was === node ||
      (was &&
        holds(was) === holds(node) &&
        sameIds(childrenOf(was), kids) &&
        sameJson(ownOf(was), ownOf(node)))
    ) {
      continue;
    }
    changed.push({
      node: ownOf(node),
      ...(holds(node) && { children: kids.map((k) => k.id) }),
    });
  }
  return changed.length * 2 > after.size ? null : changed;
};

/**
 * `prev` with the changed nodes put in, rooted at `rootId`: a node they name is theirs, any other
 * the one `prev` had, the very object when nothing under it changed. Null when they name a node
 * neither has, or one twice: they were made over another copy.
 */
export const withChangedNodes = (
  prev: DesignNode,
  rootId: string,
  nodes: readonly ChangedNode[]
): DesignNode | null => {
  const before = byId(prev);
  if (!before) {
    return null;
  }
  const changed = new Map(nodes.map((n) => [n.node.id as string, n]));
  // A node named twice, or not at all, means the nodes were made over another copy.
  let missing = false;
  const seen = new Set<string>();
  const build = (id: string): DesignNode => {
    if (seen.has(id)) {
      missing = true;
      return { id, type: "group" } as DesignNode;
    }
    seen.add(id);
    const given = changed.get(id);
    if (given) {
      const node = given.node as unknown as DesignNode;
      return given.children
        ? ({ ...node, children: given.children.map(build) } as DesignNode)
        : node;
    }
    const was = before.get(id);
    if (!was) {
      missing = true;
      return { id, type: "group" } as DesignNode;
    }
    const kids = childrenOf(was);
    if (kids.length === 0) {
      return was;
    }
    const built = kids.map((k) => build(k.id));
    return built.every((k, i) => k === kids[i])
      ? was
      : ({ ...was, children: built } as DesignNode);
  };
  const root = build(rootId);
  return missing ? null : root;
};
