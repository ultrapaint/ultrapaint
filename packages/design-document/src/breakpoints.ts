/**
 * Breakpoints (ADR 0036): the widths of the design system's `--breakpoint-*` tokens, Tailwind's
 * when it names none, and a node's fields at a width. Mobile-first: a node's own fields are the
 * smallest screen's, and `at.md` holds from `md` up until a larger breakpoint sets the field
 * again. Pure: the editor draws a frame with the tree resolved at its width, the code is written
 * with a class per breakpoint, and the inspector reads where a value comes from.
 */
import { isVariantKey } from "@ultrapaint/contracts/component-names";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { shortName, tokensOfKind } from "@ultrapaint/contracts/token-table";
import { ROOT_PX, toPx } from "@ultrapaint/contracts/token-value";
import { childrenOf } from "./tree.ts";

export interface Breakpoint {
  /** The width it starts at, in pixels. */
  readonly min: number;
  /** What it goes by in `at` and in a class's prefix: `md`. */
  readonly name: string;
}

/** Tailwind's own, which a design system that names none has. */
export const DEFAULT_BREAKPOINTS: readonly Breakpoint[] = [
  { min: 640, name: "sm" },
  { min: 768, name: "md" },
  { min: 1024, name: "lg" },
  { min: 1280, name: "xl" },
  { min: 1536, name: "2xl" },
];

/** The design system's breakpoints, smallest first; Tailwind's when it names none. */
export const breakpointsOf = (
  ds: DesignSystem | null | undefined
): readonly Breakpoint[] => {
  const found = tokensOfKind(ds, "breakpoint").flatMap((token) => {
    // A media query's `em` is the root's.
    const min = toPx(token.value, { em: ROOT_PX });
    const name = shortName(token.name);
    return min === null || name === "" ? [] : [{ min, name }];
  });
  return found.length > 0
    ? found.sort((a, b) => a.min - b.min)
    : DEFAULT_BREAKPOINTS;
};

/** The breakpoint a width falls in: the largest it reaches; null below the first, the base. */
export const breakpointAt = (
  breakpoints: readonly Breakpoint[],
  width: number
): Breakpoint | null =>
  breakpoints.filter((b) => b.min <= width).at(-1) ?? null;

/**
 * The breakpoints that hold at a breakpoint, from the smallest up to it; none at the base. An
 * app component's variant (`size=lg`, ADR 0041) is edited over the base alone.
 */
export const upTo = (
  breakpoints: readonly Breakpoint[],
  name: string | null
): readonly string[] => {
  if (name === null) {
    return [];
  }
  if (isVariantKey(name)) {
    return [name];
  }
  const index = breakpoints.findIndex((b) => b.name === name);
  return index < 0 ? [] : breakpoints.slice(0, index + 1).map((b) => b.name);
};

type Fields = Record<string, unknown>;

/**
 * A node's fields with a breakpoint's or a variant's over them; an instance's props are laid over
 * its own.
 */
export const layOver = (into: Fields, over: Fields) => {
  for (const [key, value] of Object.entries(over)) {
    if (key === "props" && value && typeof value === "object") {
      into.props = { ...(into.props as Fields | undefined), ...value };
    } else if (value !== undefined) {
      into[key] = value;
    }
  }
};

/** Resolved trees by node and by the breakpoints that hold, so a node drawn again is the same. */
const resolved = new WeakMap<DesignNode, Map<string, DesignNode>>();

const resolveWith = (
  node: DesignNode,
  holding: readonly string[],
  key: string
): DesignNode => {
  let byKey = resolved.get(node);
  const known = byKey?.get(key);
  if (known) {
    return known;
  }
  const kids = childrenOf(node);
  let changed = false;
  const children = kids.map((child) => {
    const next = resolveWith(child, holding, key);
    changed ||= next !== child;
    return next;
  });
  let out: DesignNode = node;
  if (node.at !== undefined || changed) {
    const { at, ...own } = node as DesignNode & { at?: Record<string, Fields> };
    const fields: Fields = own;
    for (const name of holding) {
      const over = at?.[name];
      if (over) {
        layOver(fields, over);
      }
    }
    if (changed) {
      fields.children = children;
    }
    out = fields as unknown as DesignNode;
  }
  if (!byKey) {
    byKey = new Map();
    resolved.set(node, byKey);
  }
  byKey.set(key, out);
  return out;
};

/**
 * The tree as it is at a breakpoint (null for the base): every node's fields with those of each
 * breakpoint up to it laid over them, smallest first, and no `at` left. A tree without `at` is
 * itself, and a node is the same object every time it is resolved at the same breakpoint.
 */
export const resolveAtBreakpoint = (
  node: DesignNode,
  breakpoints: readonly Breakpoint[],
  name: string | null
): DesignNode => {
  const holding = upTo(breakpoints, name);
  return resolveWith(node, holding, holding.join(" "));
};

/** The breakpoints the tree sets anything at, smallest first: what its code has prefixes for. */
export const breakpointsUsed = (
  node: DesignNode,
  breakpoints: readonly Breakpoint[]
): readonly Breakpoint[] => {
  const names = new Set<string>();
  const visit = (n: DesignNode) => {
    for (const name of Object.keys(n.at ?? {})) {
      names.add(name);
    }
    for (const child of childrenOf(n)) {
      visit(child);
    }
  };
  visit(node);
  return breakpoints.filter((b) => names.has(b.name));
};

/**
 * Where a field's value at a breakpoint comes from: the breakpoint itself, a smaller one it is
 * inherited from, or the node's own (`null`). A prop is named `props.<name>`.
 */
export const sourceOf = (
  node: DesignNode,
  field: string,
  breakpoints: readonly Breakpoint[],
  name: string | null
): string | null => {
  const at = (node.at ?? {}) as Record<string, Fields>;
  const prop = field.startsWith("props.") ? field.slice(6) : null;
  for (const holding of [...upTo(breakpoints, name)].reverse()) {
    const over = at[holding];
    const set =
      prop === null
        ? over?.[field] !== undefined
        : (over?.props as Fields | undefined)?.[prop] !== undefined;
    if (set) {
      return holding;
    }
  }
  return null;
};

/** The breakpoint below `name` (null for the base): what a field at `name` inherits from. */
export const breakpointBelow = (
  breakpoints: readonly Breakpoint[],
  name: string
): string | null => {
  const index = breakpoints.findIndex((b) => b.name === name);
  return index > 0 ? (breakpoints[index - 1]?.name ?? null) : null;
};

/** Fields that are the node itself, the same at every breakpoint. */
export const FIXED_FIELDS: ReadonlySet<string> = new Set([
  "at",
  "children",
  "component",
  "from",
  "id",
  "level",
  "link",
  "locked",
  "name",
  "role",
  "slot",
  "x",
  "y",
]);

/**
 * Where a node is shown, as the one rule that says so: at every width, at none, from a
 * breakpoint up, or below one. A node shown at some widths in another way is `custom`.
 */
export type Visibility =
  | { readonly kind: "every" }
  | { readonly kind: "none" }
  | { readonly at: string; readonly kind: "from" }
  | { readonly at: string; readonly kind: "below" }
  | { readonly kind: "custom" };

/** The rule a node's `hidden`, its own and its breakpoints', comes to. */
export const visibilityOf = (
  node: DesignNode,
  breakpoints: readonly Breakpoint[]
): Visibility => {
  const levels = [null, ...breakpoints.map((b) => b.name)];
  const shown = levels.map(
    (name) => !resolveAtBreakpoint(node, breakpoints, name).hidden
  );
  if (shown.every(Boolean)) {
    return { kind: "every" };
  }
  if (!shown.some(Boolean)) {
    return { kind: "none" };
  }
  // One change only, at one breakpoint: shown from it up, or below it.
  const changes = shown.flatMap((s, i) =>
    i > 0 && s !== shown[i - 1] ? [i] : []
  );
  const [at] = changes;
  const where = at === undefined ? undefined : levels[at];
  if (changes.length !== 1 || !where) {
    return { kind: "custom" };
  }
  return shown[0] ? { at: where, kind: "below" } : { at: where, kind: "from" };
};

/**
 * The fields that show a node by `rule`: its own `hidden` and its `at` with every breakpoint's
 * `hidden` taken out and the rule's put in, what is left empty gone (`null`, as an update
 * removes a field).
 */
export const withVisibility = (
  node: DesignNode,
  rule: Exclude<Visibility, { kind: "custom" }>
): { at: DesignNode["at"] | null; hidden: true | null } => {
  const at: Record<string, Record<string, unknown>> = {};
  for (const [name, fields] of Object.entries(
    (node.at ?? {}) as Record<string, Record<string, unknown>>
  )) {
    const { hidden: _hidden, ...rest } = fields;
    if (Object.keys(rest).length > 0) {
      at[name] = rest;
    }
  }
  if (rule.kind === "from" || rule.kind === "below") {
    at[rule.at] = { ...at[rule.at], hidden: rule.kind === "below" };
  }
  return {
    at: Object.keys(at).length > 0 ? (at as DesignNode["at"]) : null,
    hidden: rule.kind === "none" || rule.kind === "from" ? true : null,
  };
};
