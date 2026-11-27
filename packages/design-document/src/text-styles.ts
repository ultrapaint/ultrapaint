/**
 * A text and its text style: attached, the text takes its size, weight and line height (and
 * family and tracking) from the style as one thing; detached, it carries the same settings as
 * fields of its own and each can change on its own. Both are one `update` op, computed here,
 * with an update at each breakpoint for the style's steps (ADR 0160): its size and line height
 * from a breakpoint up, which detaching copies and attaching clears the text's own of. And what
 * an agent is told of a styled text its operations gave a size of its own.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  TEXT_STYLE_SETTINGS,
  TEXT_STYLE_STEP_SETTINGS,
  type TextStyle,
  textStyleGroup,
} from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  DocOp,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { Found } from "./ops.ts";
import { findNode, isRecord, walk } from "./tree.ts";

/**
 * A style as it is at a breakpoint: its own size and line height with its steps (`at`) at each
 * breakpoint that holds there laid over them, smallest first (ADR 0160). A style without steps,
 * or the base (no breakpoint holding), is the style itself.
 */
export const textStyleAt = (
  style: TextStyle,
  holding: readonly string[]
): TextStyle => {
  const { at } = style;
  if (at === undefined || holding.length === 0) {
    return style;
  }
  let out: TextStyle = style;
  for (const name of holding) {
    const step = at[name];
    for (const key of TEXT_STYLE_STEP_SETTINGS) {
      const value = step?.[key];
      if (value !== undefined) {
        out = { ...out, [key]: value };
      }
    }
  }
  return out;
};

/**
 * The fields that take a text off its style and keep it looking the same: the style's settings
 * copied onto the node, except where the node already has its own.
 */
export const detachTextStyle = (
  node: TextNode,
  style: TextStyle | undefined
): Record<string, JsonValue> => {
  const set: Record<string, JsonValue> = { textStyle: null };
  for (const key of TEXT_STYLE_SETTINGS) {
    const own = node[key];
    const value = own ?? style?.[key];
    if (own === undefined && value !== undefined) {
      set[key] = value;
    }
  }
  return set;
};

/**
 * The fields that set a text in a style: the style's name, the settings the style stands for
 * taken off the node, and the role and level the style is meant for.
 */
export const attachTextStyle = (
  style: TextStyle
): Record<string, JsonValue> => {
  const set: Record<string, JsonValue> = { textStyle: style.name };
  for (const key of TEXT_STYLE_SETTINGS) {
    set[key] = null;
  }
  set.role = style.role;
  set.level = style.role === "heading" ? (style.level ?? 1) : null;
  return set;
};

const isStep = (key: string): boolean =>
  (TEXT_STYLE_STEP_SETTINGS as readonly string[]).includes(key);

/** A text's fields at a breakpoint, as its `at` holds them. */
const fieldsAt = (node: TextNode, name: string) =>
  (
    node.at as Record<string, Record<string, unknown> | undefined> | undefined
  )?.[name];

/**
 * The updates that copy a style's steps onto a text taken off it, so that it looks the same at
 * every width (ADR 0160): each step's size and line height at its breakpoint, but none the text
 * sets itself, as its own or at that breakpoint or a smaller one (`order`, the design system's,
 * smallest first), which held over the step, and none of the settings `except` names (the one
 * being edited as the text is detached).
 */
export const detachedSteps = (
  node: TextNode,
  style: TextStyle | undefined,
  order: readonly string[],
  except: readonly string[] = []
): DocOp[] => {
  const steps = style?.at ?? {};
  const known = order.filter((name) => steps[name] !== undefined);
  const names = [
    ...known,
    ...Object.keys(steps).filter((name) => !order.includes(name)),
  ];
  return names.flatMap((name): DocOp[] => {
    const holding = order.includes(name)
      ? order.slice(0, order.indexOf(name) + 1)
      : [name];
    const set: Record<string, JsonValue> = {};
    for (const key of TEXT_STYLE_STEP_SETTINGS) {
      const value = steps[name]?.[key];
      const own =
        node[key] !== undefined ||
        holding.some((at) => fieldsAt(node, at)?.[key] !== undefined);
      if (value !== undefined && !own && !except.includes(key)) {
        set[key] = value;
      }
    }
    return Object.keys(set).length > 0
      ? [{ at: name, id: node.id, op: "update", set }]
      : [];
  });
};

/**
 * The updates that clear a text's own size and line height at each breakpoint it sets them, as
 * it is set in a style (ADR 0160): left there, they would hide the style's steps.
 */
export const attachedSteps = (node: TextNode): DocOp[] =>
  Object.keys(node.at ?? {}).flatMap((name): DocOp[] => {
    const fields = fieldsAt(node, name) ?? {};
    const set: Record<string, JsonValue> = {};
    for (const key of TEXT_STYLE_STEP_SETTINGS) {
      if (fields[key] !== undefined) {
        set[key] = null;
      }
    }
    return Object.keys(set).length > 0
      ? [{ at: name, id: node.id, op: "update", set }]
      : [];
  });

/**
 * A text set in a style, as one edit: the style's fields (`attachTextStyle`), then its own size
 * and line height cleared at every breakpoint (`attachedSteps`). The text is as it is stored. A
 * size or line height it has only at a breakpoint is cleared there alone, not also by the update
 * that names no breakpoint, which an editor may land where the value it shows comes from.
 */
export const attachTextStyleOps = (
  node: TextNode,
  style: TextStyle
): DocOp[] => {
  const set = Object.fromEntries(
    Object.entries(attachTextStyle(style)).filter(
      ([key]) => !(isStep(key) && node[key as keyof TextNode] === undefined)
    )
  );
  return [{ id: node.id, op: "update", set }, ...attachedSteps(node)];
};

/**
 * A text taken off its style, as one edit, so that it looks the same at every width: the
 * style's settings on the text as it is drawn where the edit lands (`drawn`, with the style at
 * the breakpoints that hold there, `holding`), with `also` set over them; then the style's steps
 * copied into the stored text's own (`stored`), but for the settings `also` sets.
 */
export const detachTextStyleOps = (
  drawn: TextNode,
  stored: TextNode,
  style: TextStyle | undefined,
  breakpoints: {
    readonly holding: readonly string[];
    readonly order: readonly string[];
  },
  also: Record<string, JsonValue> = {}
): DocOp[] => [
  {
    id: drawn.id,
    op: "update",
    set: {
      ...detachTextStyle(
        drawn,
        style && textStyleAt(style, breakpoints.holding)
      ),
      ...also,
    },
  },
  ...detachedSteps(stored, style, breakpoints.order, Object.keys(also)),
];

/** A field a text holds, own or at a breakpoint: `size`, `at.sm.lineHeight`. */
const heldAt = (node: TextNode, field: string): unknown => {
  const [first, name, key] = field.split(".");
  return first === "at" && name !== undefined && key !== undefined
    ? fieldsAt(node, name)?.[key]
    : (node as unknown as Record<string, unknown>)[field];
};

/** The sizes and line heights fields set, own (`size`) or at a breakpoint (`at.sm.size`). */
const stepFieldsOf = (
  fields: Readonly<Record<string, unknown>>,
  at: string | undefined
): string[] =>
  Object.entries(fields).flatMap(([key, value]): string[] => {
    if (value === null || value === undefined) {
      return [];
    }
    if (isStep(key)) {
      return [at === undefined ? key : `at.${at}.${key}`];
    }
    if (key !== "at" || at !== undefined || !isRecord(value)) {
      return [];
    }
    return Object.entries(value).flatMap(([name, over]) =>
      isRecord(over) ? stepFieldsOf(over, name) : []
    );
  });

/** The texts each operation gave a size or a line height, by id, with the fields it set. */
const stepsSet = (found: readonly Found[]): Map<string, Set<string>> => {
  const set = new Map<string, Set<string>>();
  const add = (id: string, fields: readonly string[]) => {
    if (fields.length > 0) {
      set.set(id, new Set([...(set.get(id) ?? []), ...fields]));
    }
  };
  for (const { layer, op, placed } of found) {
    if (op.op === "update" && !layer) {
      add(op.id, stepFieldsOf(op.set, op.at));
    } else if (placed) {
      for (const node of walk(placed)) {
        add(
          node.id,
          stepFieldsOf(node as unknown as Record<string, unknown>, undefined)
        );
      }
    }
  }
  return set;
};

/**
 * What an agent is told of the texts its operations gave a size or a line height of their own
 * while they are set in a text style (ADR 0160): each, by the style and the fields that now
 * override it, as the call leaves the page (`after`). Overrides already on the page that the call
 * did not set are not named, nor a text the call took off its style.
 */
export const styleOverrides = (
  found: readonly Found[],
  after: DesignNode
): { readonly message: string; readonly nodeId: string }[] =>
  [...stepsSet(found)].flatMap(([id, fields]) => {
    const node = findNode(after, id);
    if (node?.type !== "text" || node.textStyle === undefined) {
      return [];
    }
    const held = [...fields].filter((f) => heldAt(node, f) !== undefined);
    if (held.length === 0) {
      return [];
    }
    const one = held.length === 1;
    return [
      {
        message: `${held.join(" and ")} ${one ? "overrides" : "override"} its text style ${node.textStyle}. Set ${one ? "it" : "them"} to null to keep the style's, or textStyle to null to detach the style.`,
        nodeId: id,
      },
    ];
  });

/**
 * How many of the text's own settings the style says the same of; -1 when it says otherwise of
 * one. A setting the style leaves unsaid is no contradiction, and no match either.
 */
const settingsShared = (node: TextNode, style: TextStyle): number => {
  let shared = 0;
  for (const key of TEXT_STYLE_SETTINGS) {
    const own = node[key];
    const theirs = style[key];
    if (own === undefined || theirs === undefined) {
      continue;
    }
    if (own !== theirs) {
      return -1;
    }
    shared += 1;
  }
  return shared;
};

/** The style that says the most of the text's own settings and nothing against them: the first of those. */
const closestStyle = (
  node: TextNode,
  styles: readonly TextStyle[]
): TextStyle | undefined => {
  if (TEXT_STYLE_SETTINGS.every((key) => node[key] === undefined)) {
    return;
  }
  let best: TextStyle | undefined;
  let most = -1;
  for (const style of styles) {
    const shared = settingsShared(node, style);
    if (shared > most) {
      best = style;
      most = shared;
    }
  }
  return best;
};

/**
 * The style a detached text goes back to: the one it matches setting for setting, else the one
 * meant for its role and level, else the first of its group.
 */
export const matchTextStyle = (
  node: TextNode,
  styles: readonly TextStyle[]
): TextStyle | undefined => {
  const group = node.role === "heading" ? "heading" : "body";
  return (
    closestStyle(node, styles) ??
    styles.find(
      (s) =>
        s.role === node.role &&
        (node.role !== "heading" || s.level === (node.level ?? 1))
    ) ??
    styles.find((s) => textStyleGroup(s) === group) ??
    styles[0]
  );
};

/** The styles in their groups, in the groups' order, for a list to show them under headings. */
export const groupTextStyles = <T extends TextStyle>(
  styles: readonly T[]
): ReadonlyMap<ReturnType<typeof textStyleGroup>, T[]> => {
  const groups = new Map<ReturnType<typeof textStyleGroup>, T[]>([
    ["heading", []],
    ["body", []],
    ["other", []],
  ]);
  for (const style of styles) {
    groups.get(textStyleGroup(style))?.push(style);
  }
  return groups;
};
