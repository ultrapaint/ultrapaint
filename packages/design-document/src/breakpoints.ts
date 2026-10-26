/**
 * Breakpoints (ADR 0036): the widths of the design system's `--breakpoint-*` tokens, Tailwind's
 * when it names none, and a node's fields at a width. Mobile-first: a node's own fields are the
 * smallest screen's, and `at.md` holds from `md` up until a larger breakpoint sets the field
 * again. Pure: the editor draws a frame with the tree resolved at its width, the code is written
 * with a class per breakpoint, and the inspector reads where a value comes from.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { toPixels } from "./tokens.ts";
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

const TOKEN_PREFIX = "breakpoint-";

/** What the base, below every breakpoint, is called where a breakpoint's name would be. */
export const BASE_NAME = "base";

/** The design system's breakpoints, smallest first; Tailwind's when it names none. */
export const breakpointsOf = (
  ds: DesignSystem | null | undefined
): readonly Breakpoint[] => {
  const found = (ds?.layout?.breakpoints ?? []).flatMap((token) => {
    const min = toPixels(token.value);
    const name = token.name.startsWith(TOKEN_PREFIX)
      ? token.name.slice(TOKEN_PREFIX.length)
      : token.name;
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

/** The breakpoints that hold at a breakpoint, from the smallest up to it; none at the base. */
const upTo = (
  breakpoints: readonly Breakpoint[],
  name: string | null
): readonly string[] => {
  if (name === null) {
    return [];
  }
  const index = breakpoints.findIndex((b) => b.name === name);
  return index < 0 ? [] : breakpoints.slice(0, index + 1).map((b) => b.name);
};

type Fields = Record<string, unknown>;

/** A node's fields with a breakpoint's over them; an instance's props are laid over its own. */
const layOver = (into: Fields, over: Fields) => {
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

/** The tree as it is drawn at a width. */
export const resolveAt = (
  node: DesignNode,
  breakpoints: readonly Breakpoint[],
  width: number
): DesignNode =>
  resolveAtBreakpoint(
    node,
    breakpoints,
    breakpointAt(breakpoints, width)?.name ?? null
  );

/** Whether anything in the tree differs at some breakpoint. */
export const hasOverrides = (node: DesignNode): boolean =>
  (node.at !== undefined && Object.keys(node.at).length > 0) ||
  childrenOf(node).some(hasOverrides);

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
  "x",
  "y",
]);
