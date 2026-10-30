/**
 * What changed between two versions of a design's tree: the nodes added, removed, moved and
 * changed, matched by id. A page keeps its tree as it was when it was implemented (ADR 0030), and
 * the next implementation is told this diff rather than handed the whole design as new. Pure and
 * synchronous.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  childrenOf,
  type IndexedNode,
  indexTree,
  nodeLabel,
  sameJson,
} from "./tree.ts";

/** A node as the diff names it: its id, what it is, and what the layers panel calls it. */
export interface NodeRef {
  readonly id: string;
  readonly label: string;
  readonly type: DesignNode["type"];
}

/** Where a node sits: its parent's id, null for the root, and its index among the children. */
export interface Place {
  readonly index: number;
  readonly parent: string | null;
}

/** One field of a node that holds another value; `undefined` where a side does not set it. */
export interface FieldChange {
  readonly after: unknown;
  readonly before: unknown;
  readonly field: string;
}

/** A node that is new, with everything inside it. */
export interface AddedNode extends NodeRef, Place {
  readonly node: DesignNode;
}

/** A node that is gone, with everything inside it. */
export interface RemovedNode extends NodeRef {
  readonly parent: string | null;
}

/** A node that has another parent, or another place among the siblings it kept. */
export interface MovedNode extends NodeRef {
  readonly from: Place;
  readonly to: Place;
}

/** A node whose own fields changed, its children aside. */
export interface ChangedNode extends NodeRef {
  readonly fields: readonly FieldChange[];
}

export interface TreeDiff {
  /** The topmost node of each added subtree, in the order of the tree after. */
  readonly added: readonly AddedNode[];
  readonly changed: readonly ChangedNode[];
  readonly moved: readonly MovedNode[];
  /**
   * Every parent the entries name, by id, as the tree after has it, or as the tree before had it
   * when it is gone: so that the diff reads on its own.
   */
  readonly parents: Readonly<Record<string, NodeRef>>;
  /** The topmost node of each removed subtree, in the order of the tree before. */
  readonly removed: readonly RemovedNode[];
}

/** Every node by id with its place, in document order. */
const indexOf = (root: DesignNode): Map<string, IndexedNode> =>
  indexTree(root).nodes;

const refOf = (node: DesignNode): NodeRef => ({
  id: node.id,
  label: nodeLabel(node),
  type: node.type,
});

/** Fields that are the tree itself rather than the node's own. */
const STRUCTURAL = new Set(["children", "id"]);

/**
 * A node's fields as the diff compares them: what a breakpoint sets is a field of its own,
 * `at.md.gap` (ADR 0036), so that a change says which width it is for.
 */
const flatFields = (node: DesignNode): Record<string, unknown> => {
  const { at, ...own } = node as DesignNode & {
    at?: Record<string, Record<string, unknown>>;
  };
  const out: Record<string, unknown> = { ...own };
  for (const [breakpoint, fields] of Object.entries(at ?? {})) {
    for (const [field, value] of Object.entries(fields)) {
      out[`at.${breakpoint}.${field}`] = value;
    }
  }
  return out;
};

const fieldChanges = (before: DesignNode, after: DesignNode): FieldChange[] => {
  const a = flatFields(before);
  const b = flatFields(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys)
    .filter((key) => !STRUCTURAL.has(key))
    .sort()
    .filter((key) => !sameJson(a[key], b[key]))
    .map((field) => ({ after: b[field], before: a[field], field }));
};

/**
 * The positions of a longest strictly increasing subsequence of `values`: the siblings that kept
 * their order, so that only the others count as moved.
 */
const longestIncreasing = (values: readonly number[]): Set<number> => {
  const tails: number[] = [];
  const previous: number[] = [];
  values.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((values[tails[mid] as number] as number) < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    previous[i] = low > 0 ? (tails[low - 1] as number) : -1;
    tails[low] = i;
  });
  const kept = new Set<number>();
  let at = tails.length > 0 ? (tails.at(-1) as number) : -1;
  while (at >= 0) {
    kept.add(at);
    at = previous[at] as number;
  }
  return kept;
};

/**
 * The ids, among a node's children after, that kept the same parent but not their order among
 * the siblings both trees share. A sibling only shifted by an insertion or a removal is not one.
 */
const reordered = (
  parent: DesignNode,
  before: ReadonlyMap<string, IndexedNode>
): Set<string> => {
  const common = childrenOf(parent).filter(
    (child) => before.get(child.id)?.parent === parent.id
  );
  const kept = longestIncreasing(
    common.map((child) => (before.get(child.id) as IndexedNode).index)
  );
  return new Set(
    common.filter((_, i) => !kept.has(i)).map((child) => child.id)
  );
};

const placeOf = (entry: IndexedNode): Place => ({
  index: entry.index,
  parent: entry.parent,
});

/**
 * The entries of one tree whose id the other lacks, and whose parent it has: the topmost node of
 * each subtree only one of them holds, in the first tree's order.
 */
const topmostMissing = (
  tree: ReadonlyMap<string, IndexedNode>,
  other: ReadonlyMap<string, IndexedNode>
): IndexedNode[] =>
  Array.from(tree.values()).filter(
    (entry) =>
      !other.has(entry.node.id) &&
      (entry.parent === null || other.has(entry.parent))
  );

/**
 * What changed from one tree to another, nodes matched by id. A subtree added or removed whole is
 * one entry, its topmost node; a node is moved when its parent changed, or its order among the
 * siblings it had before; a node's fields are compared, `children` and `id` aside, as JSON.
 */
export const diffTrees = (before: DesignNode, after: DesignNode): TreeDiff => {
  const was = indexOf(before);
  const is = indexOf(after);
  const added: AddedNode[] = [];
  const removed: RemovedNode[] = [];
  const moved: MovedNode[] = [];
  const changed: ChangedNode[] = [];
  const parents: Record<string, NodeRef> = {};
  const nameParent = (id: string | null) => {
    const node = id === null ? undefined : (is.get(id) ?? was.get(id))?.node;
    if (node) {
      parents[node.id] = refOf(node);
    }
  };

  const shuffled = new Set<string>();
  for (const { node } of is.values()) {
    for (const id of reordered(node, was)) {
      shuffled.add(id);
    }
  }

  for (const now of topmostMissing(is, was)) {
    added.push({ ...refOf(now.node), ...placeOf(now), node: now.node });
    nameParent(now.parent);
  }
  for (const then of topmostMissing(was, is)) {
    removed.push({ ...refOf(then.node), parent: then.parent });
    nameParent(then.parent);
  }

  for (const [id, now] of is) {
    const then = was.get(id);
    if (!then) {
      continue;
    }
    if (then.parent !== now.parent || shuffled.has(id)) {
      moved.push({ ...refOf(now.node), from: placeOf(then), to: placeOf(now) });
      nameParent(then.parent);
      nameParent(now.parent);
    }
    const fields = fieldChanges(then.node, now.node);
    if (fields.length > 0) {
      changed.push({ ...refOf(now.node), fields });
    }
  }

  return { added, changed, moved, parents, removed };
};

/** Whether a diff has nothing to say. */
export const isEmptyDiff = (diff: TreeDiff): boolean =>
  diff.added.length === 0 &&
  diff.removed.length === 0 &&
  diff.moved.length === 0 &&
  diff.changed.length === 0;

const describeRef = (ref: NodeRef) =>
  `${ref.type} ${JSON.stringify(ref.label)} (${ref.id})`;

const describeParent = (diff: TreeDiff, id: string | null) => {
  if (id === null) {
    return "the top";
  }
  const ref = diff.parents[id];
  return ref ? describeRef(ref) : `(${id})`;
};

const describeValue = (value: unknown) =>
  value === undefined ? "(none)" : JSON.stringify(value);

const describeMove = (diff: TreeDiff, move: MovedNode) =>
  move.from.parent === move.to.parent
    ? `- moved ${describeRef(move)} within ${describeParent(diff, move.to.parent)} from ${move.from.index} to ${move.to.index}`
    : `- moved ${describeRef(move)} from ${describeParent(diff, move.from.parent)} at ${move.from.index} to ${describeParent(diff, move.to.parent)} at ${move.to.index}`;

/**
 * The diff as plain lines an agent reads, one per entry: added, removed, moved, then changed,
 * values written as JSON and an unset one as `(none)`. "No changes." when there are none.
 */
export const describeDiff = (diff: TreeDiff): string => {
  if (isEmptyDiff(diff)) {
    return "No changes.";
  }
  return [
    ...diff.added.map((add) =>
      add.parent === null
        ? `- added ${describeRef(add)} as the root`
        : `- added ${describeRef(add)} in ${describeParent(diff, add.parent)} at ${add.index}`
    ),
    ...diff.removed.map((remove) =>
      remove.parent === null
        ? `- removed ${describeRef(remove)}, the root`
        : `- removed ${describeRef(remove)} from ${describeParent(diff, remove.parent)}`
    ),
    ...diff.moved.map((move) => describeMove(diff, move)),
    ...diff.changed.map(
      (change) =>
        `- changed ${describeRef(change)}: ${change.fields
          .map(
            (f) =>
              `${f.field} ${describeValue(f.before)} → ${describeValue(f.after)}`
          )
          .join("; ")}`
    ),
  ].join("\n");
};
