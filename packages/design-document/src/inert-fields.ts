/**
 * Inert fields: what an agent's operations set that did nothing to the page, each with why, so
 * that it is told rather than left to believe the page shows it. A field its node's type does not
 * have (dropped when the document is written), a stack's gap or wrap with at most one node to
 * space, a breakpoint's value that is the node's own, a value the node already had, a `null` on
 * a field it did not have. A layer of an instance is judged by its kind and its instance override
 * only: the rest of it is its main component's, which the page does not show. Reported, never
 * refused: the operations apply as they are.
 */
import {
  type DesignNode,
  NODE_FIELDS,
  type NodeFields,
} from "@ultrapaint/contracts/document";
import { instanceLayerOf } from "./instance-layers.ts";
import type { Found } from "./ops.ts";
import { childrenOf, findNode, isRecord, sameJson, walk } from "./tree.ts";

/** A field an operation set that did nothing: `at.md.gap` for a breakpoint's. */
export interface InertField {
  readonly field: string;
  readonly id: string;
  readonly why: string;
}

const STACKS = new Set(["page", "row", "column"]);
const SPACING = new Set(["gap", "wrap"]);

const fieldsOf = (type: string | undefined): NodeFields | undefined =>
  type === undefined
    ? undefined
    : (NODE_FIELDS as Record<string, NodeFields | undefined>)[type];

/** Why a node of this kind keeps no such field, own or at a breakpoint, if it keeps none. */
const lacks = (
  kind: string | undefined,
  what: string,
  key: string,
  at: string | undefined
): string | null => {
  const fields = fieldsOf(kind);
  if (fields === undefined) {
    return null;
  }
  if (at === undefined ? fields.own.has(key) : fields.at.has(key)) {
    return null;
  }
  return at !== undefined && fields.own.has(key)
    ? `${what} has no ${key} at a breakpoint`
    : `${what} has no ${key}`;
};

/** Why setting the value changed nothing on the node as the operation found it. */
const unchanged = (
  fields: Readonly<Record<string, unknown>> | undefined,
  key: string,
  value: unknown,
  at: string | undefined
): string | null => {
  if (fields === undefined) {
    return null;
  }
  const over =
    at === undefined
      ? fields
      : (fields.at as Record<string, unknown> | undefined)?.[at];
  const held = isRecord(over) ? over[key] : undefined;
  if (value === null) {
    return held === undefined
      ? `it has no ${key}${at === undefined ? "" : ` at ${at}`} to take off`
      : null;
  }
  return sameJson(held, value) ? "already set to that" : null;
};

/**
 * Why a breakpoint's value changes nothing on the node as the call leaves it: it is the value
 * the node already has there, its own (ADR 0036, mobile-first), and no smaller breakpoint
 * (`order`, the design system's, smallest first) sets the field otherwise. One that brings the
 * own value back above a smaller breakpoint's does something.
 */
const sameAsOwn = (
  fields: Readonly<Record<string, unknown>> | null,
  key: string,
  at: string | undefined,
  order: readonly string[]
): string | null => {
  // A breakpoint the design system does not name is not judged: what is below it is unknown.
  if (!fields || at === undefined || !order.includes(at)) {
    return null;
  }
  const own = fields[key];
  const breakpoints = (fields.at ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const over = breakpoints[at]?.[key];
  // The value from below: the nearest smaller breakpoint's that sets the field, or the own.
  const below = order
    .slice(0, order.indexOf(at))
    .toReversed()
    .map((name) => breakpoints[name]?.[key])
    .find((value) => value !== undefined);
  return own !== undefined &&
    over !== undefined &&
    sameJson(own, over) &&
    (below === undefined || sameJson(below, own))
    ? `the same as its own ${key}`
    : null;
};

/** Why a gap or a wrap spaces nothing: its stack holds one node or none as the call leaves it. */
const unspaced = (node: DesignNode | null, key: string): string | null => {
  if (node === null || !SPACING.has(key) || !STACKS.has(node.type)) {
    return null;
  }
  const count = childrenOf(node).length;
  return count > 1
    ? null
    : `the ${node.type} holds ${count === 0 ? "nothing" : "one node"}: ${key} needs two`;
};

/** A field an operation set: at a breakpoint, or inside a whole `at` it set at once. */
interface Setting {
  readonly at: string | undefined;
  /** Set inside a whole `at`: what the breakpoint held before is replaced, not compared. */
  readonly inner: boolean;
  readonly key: string;
  readonly value: unknown;
}

/** The fields a `set` (or a node put in) sets, a whole `at` also read breakpoint by breakpoint. */
const settingsOf = (
  set: Readonly<Record<string, unknown>>,
  at: string | undefined
): Setting[] =>
  Object.entries(set).flatMap(([key, value]): Setting[] => {
    if (value === undefined) {
      return [];
    }
    const own = { at, inner: false, key, value };
    if (at !== undefined || key !== "at" || !isRecord(value)) {
      return [own];
    }
    return [
      own,
      ...Object.entries(value).flatMap(([name, fields]) =>
        Object.entries(isRecord(fields) ? fields : {}).map(([inner, v]) => ({
          at: name,
          inner: true,
          key: inner,
          value: v,
        }))
      ),
    ];
  });

const fieldName = ({ at, key }: Setting) =>
  at === undefined ? key : `at.${at}.${key}`;

/** Why a field an update set on a node of the document did nothing. */
const updateWhy = (
  node: DesignNode | null,
  fields: Found["fields"],
  { at, inner, key, value }: Setting,
  order: readonly string[]
): string | null => {
  const before = inner ? null : unchanged(fields, key, value, at);
  if (value === null) {
    return before;
  }
  return (
    lacks(node?.type, `a ${node?.type}`, key, at) ??
    before ??
    sameAsOwn(asFields(node), key, at, order) ??
    unspaced(node, key)
  );
};

const asFields = (node: DesignNode | null) =>
  node as unknown as Readonly<Record<string, unknown>> | null;

/** The kind a layer of an instance is drawn as: its instance override's, or its main component's. */
const layerKind = (
  after: DesignNode,
  id: string,
  main: string | undefined
): string | undefined => {
  const way = instanceLayerOf(id);
  const instance = way === null ? null : findNode(after, way.instance);
  const own =
    instance?.type === "instance" && way !== null
      ? instance.overrides?.[way.layer]?.type
      : undefined;
  return typeof own === "string" ? own : main;
};

/** Why a field an update set on a layer of an instance did nothing. */
const layerWhy = (
  kind: string | undefined,
  fields: Found["fields"],
  { at, inner, key, value }: Setting
): string | null => {
  const before = inner ? null : unchanged(fields, key, value, at);
  if (value === null) {
    return before;
  }
  // A breakpoint's value is not judged against the own: its main component's layer may set the
  // field at that breakpoint or a smaller one, which the page does not show.
  return lacks(kind, `a ${kind} layer`, key, at) ?? before;
};

/** What one operation set that did nothing, each field with why, or `null` where it did. */
const judged = (
  entry: Found,
  after: DesignNode,
  order: readonly string[]
): { field: string; id: string; why: string | null }[] => {
  const { op } = entry;
  if (op.op === "insert" || op.op === "replace") {
    // A node put in, by the id it has on the page, judged on the page the call leaves.
    return Array.from(entry.placed ? walk(entry.placed) : []).flatMap(
      (given) => {
        const node = findNode(after, given.id);
        return node === null
          ? []
          : settingsOf(asFields(given) ?? {}, undefined).map((s) => ({
              field: fieldName(s),
              id: node.id,
              why:
                lacks(node.type, `a ${node.type}`, s.key, s.at) ??
                sameAsOwn(asFields(node), s.key, s.at, order) ??
                unspaced(node, s.key),
            }));
      }
    );
  }
  if (op.op !== "update") {
    return [];
  }
  const settings = settingsOf(op.set, op.at);
  if (entry.layer) {
    const kind = layerKind(after, op.id, entry.layer.kind);
    return settings.map((s) => ({
      field: fieldName(s),
      id: op.id,
      why: layerWhy(kind, entry.fields, s),
    }));
  }
  const node = findNode(after, op.id);
  return settings.map((s) => ({
    field: fieldName(s),
    id: op.id,
    why: updateWhy(node, entry.fields, s, order),
  }));
};

/**
 * Each field the operations set that did nothing, in their order, once: an update's judged
 * against the node as it found it for a value it already had, and on the tree the call leaves
 * (`after`) for the rest; a node an insert or a replace put in by the ids it has on the page.
 */
export const inertFields = (
  found: readonly Found[],
  after: DesignNode,
  /** The design system's breakpoints, smallest first: what a breakpoint's value is judged by. */
  order: readonly string[]
): InertField[] => {
  const inert = new Map<string, InertField>();
  for (const { field, id, why } of found.flatMap((f) =>
    judged(f, after, order)
  )) {
    if (why !== null) {
      inert.set(`${id}\u0000${field}\u0000${why}`, { field, id, why });
    }
  }
  return [...inert.values()];
};
