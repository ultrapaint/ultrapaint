/**
 * The spacing a selected stack lets the pointer drag on the canvas (ADR 0145): from where the
 * stack and its children are drawn, its **spacing bands**, one for each gap between two children
 * next to each other in a line and one for each side of its padding; and the length a dragged
 * band snaps to, a named step of the spacing scale or a named spacing of the design system, or
 * the pixel with ⌘/Ctrl held. Pure: the chrome measures, the gesture follows the pointer.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  Length,
  MainAlign,
} from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import {
  SPACING_STEPS,
  spacingBasePx,
  spacingStepName,
  spacingStepOf,
  tokensOfKind,
} from "@ultrapaint/contracts/token-table";
import { ROOT_PX, toPx } from "@ultrapaint/contracts/token-value";
import { type Side, sidesOf } from "../lib/sides.ts";

/** Which way a band is dragged: across the frame (`x`) or down it (`y`). */
export type Axis = "x" | "y";

/** The field a band changes. */
export type SpacingField = "gap" | "padding";

/** One space of a stack the pointer can drag: a gap between two children, or a padding side. */
export interface Band {
  readonly axis: Axis;
  readonly field: SpacingField;
  /** Where the pointer grabs it: the space, made up to the least a pointer can reach. */
  readonly hit: Rect;
  /** Names it among the stack's bands, the same while the stack keeps its children. */
  readonly key: string;
  /** Its length as drawn, in the frame's pixels. */
  readonly px: number;
  /** The space as drawn, in the frame's pixels. */
  readonly rect: Rect;
  /** The padding's side; none for a gap. */
  readonly side?: Side;
  /** Whether moving the pointer the axis's way grows it (`1`) or shrinks it (`-1`). */
  readonly sign: 1 | -1;
}

/** What makes a node a stack: the fields its bands are worked out from. */
export interface StackFields {
  readonly align: MainAlign | undefined;
  readonly direction: "row" | "column";
}

/** A stack as drawn: its box, its children's boxes in order, and its spacing in pixels. */
export interface DrawnStack extends StackFields {
  readonly box: Rect;
  readonly children: readonly Rect[];
  readonly gap: number;
  readonly padding: Readonly<Record<Side, number>>;
}

/**
 * The stack a node is, when it has the stack's fields: a row, a column or a page (a column unless
 * its direction says row); null for any other kind. Read off the node as its view draws it, so a
 * row turned column at a breakpoint is a column there.
 */
export const stackOf = (
  node: DesignNode
): (StackFields & { readonly gap: Length | undefined }) | null => {
  if (node.type === "row" || node.type === "column") {
    return { align: node.align, direction: node.type, gap: node.gap };
  }
  if (node.type === "page") {
    return {
      align: node.align,
      direction: node.direction ?? "column",
      gap: node.gap,
    };
  }
  return null;
};

/** `r` made at least `least` thick along `axis`, about its middle. */
const thickAbout = (r: Rect, axis: Axis, least: number): Rect => {
  if (axis === "x") {
    const width = Math.max(r.width, least);
    return { ...r, width, x: r.x - (width - r.width) / 2 };
  }
  const height = Math.max(r.height, least);
  return { ...r, height, y: r.y - (height - r.height) / 2 };
};

/** The children in lines, a line ending where the next child does not come after the last. */
const linesOf = (children: readonly Rect[], row: boolean): Rect[][] => {
  const lines: Rect[][] = [];
  let line: Rect[] = [];
  for (const child of children) {
    const last = line.at(-1);
    const after =
      last === undefined ||
      (row
        ? child.x >= last.x + last.width - 0.5
        : child.y >= last.y + last.height - 0.5);
    if (!after) {
      lines.push(line);
      line = [];
    }
    line.push(child);
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
};

/**
 * The gaps of each line: the space from one child to the next, at the gap's own width in the
 * middle of a space a child's margin makes wider, as long as the line is across it. None where
 * the alignment spreads the children (between, around): that space is the alignment's.
 */
const gapBands = (stack: DrawnStack, least: number): Band[] => {
  if (stack.align === "between" || stack.align === "around") {
    return [];
  }
  const row = stack.direction === "row";
  const axis = row ? "x" : "y";
  const bands: Band[] = [];
  for (const line of linesOf(stack.children, row)) {
    const from = Math.min(...line.map((c) => (row ? c.y : c.x)));
    const to = Math.max(
      ...line.map((c) => (row ? c.y + c.height : c.x + c.width))
    );
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1] as Rect;
      const b = line[i] as Rect;
      const end = row ? a.x + a.width : a.y + a.height;
      const space = Math.max(0, (row ? b.x : b.y) - end);
      const length = Math.min(space, stack.gap);
      const at = end + (space - length) / 2;
      const rect: Rect = row
        ? { height: to - from, width: length, x: at, y: from }
        : { height: length, width: to - from, x: from, y: at };
      bands.push({
        axis,
        field: "gap",
        hit: thickAbout(rect, axis, least),
        key: `gap-${bands.length}`,
        px: stack.gap,
        rect,
        sign: 1,
      });
    }
  }
  return bands;
};

/**
 * A band for each side of the padding, dragged into the box to grow it. The top and the bottom
 * run the box's width; the left and the right run between them, so a corner is one band's. A
 * thin one is grabbed by the least thickness, inside the box. On a stack too short to leave the
 * sides that much between the top and the bottom, the sides run its height and the top and the
 * bottom run between them, each at most half of it: no band is under another.
 */
const paddingBands = (stack: DrawnStack, least: number): Band[] => {
  const { box, padding } = stack;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const left = Math.max(padding.left, least);
  const after = Math.max(padding.right, least);
  const short =
    box.height -
      Math.max(padding.top, least) -
      Math.max(padding.bottom, least) <
    least;
  const top = Math.max(padding.top, least);
  const below = Math.max(padding.bottom, least);
  const above = short ? Math.min(top, box.height / 2) : top;
  const under = short ? Math.min(below, box.height / 2) : below;
  const across = short
    ? { width: Math.max(0, box.width - left - after), x: box.x + left }
    : { width: box.width, x: box.x };
  const middle = short
    ? { height: box.height, y: box.y }
    : { height: box.height - top - below, y: box.y + top };
  const side = (
    s: Side,
    rect: Rect,
    hit: Rect,
    axis: Axis,
    sign: 1 | -1
  ): Band => ({
    axis,
    field: "padding",
    hit,
    key: `padding-${s}`,
    px: padding[s],
    rect,
    side: s,
    sign,
  });
  const between = {
    height: Math.max(0, box.height - padding.top - padding.bottom),
    y: box.y + padding.top,
  };
  return [
    side(
      "top",
      { ...box, height: padding.top },
      { ...across, height: above, y: box.y },
      "y",
      1
    ),
    side(
      "right",
      { ...between, width: padding.right, x: right - padding.right },
      { ...middle, width: after, x: right - after },
      "x",
      -1
    ),
    side(
      "bottom",
      { ...box, height: padding.bottom, y: bottom - padding.bottom },
      { ...across, height: under, y: bottom - under },
      "y",
      -1
    ),
    side(
      "left",
      { ...between, width: padding.left, x: box.x },
      { ...middle, width: left, x: box.x },
      "x",
      1
    ),
  ];
};

/**
 * A stack's bands, its gaps first, then its padding's sides in CSS order. `least` is the
 * thinnest the pointer's band of one may be, in the frame's pixels: a few on screen.
 */
export const spacingBands = (stack: DrawnStack, least: number): Band[] => [
  ...gapBands(stack, least),
  ...paddingBands(stack, least),
];

/** A length the drag can snap to: a step of the scale or a named spacing. */
export interface SpacingTarget {
  readonly name: string;
  readonly px: number;
  /** What it is written as: a step as its pixels, a named spacing as its token. */
  readonly value: JsonValue;
}

/** A token named in a value: `$spacing-gutter`. */
const TOKEN_REF_RE = /^\$(.+)$/;

/** A length in pixels, a `rem` being the root's. */
const lengthPx = (css: string) => toPx(css, { em: ROOT_PX });

/**
 * What a drag snaps to: the design system's named spacings (`spacing-gutter`, read in pixels),
 * then the scale's named steps over its base. A token named as a step is that step, and a named
 * spacing that is no length in pixels is left out.
 */
export const spacingTargets = (
  ds: DesignSystem | null
): readonly SpacingTarget[] => {
  const base = spacingBasePx(ds?.spacing.base);
  const named = tokensOfKind(ds, "spacing").flatMap((token) => {
    const px = lengthPx(token.value);
    return spacingStepOf(token.name) === null &&
      token.name !== "spacing" &&
      px !== null
      ? [{ name: token.name, px, value: `$${token.name}` }]
      : [];
  });
  const steps = SPACING_STEPS.map((step) => ({
    name: spacingStepName(step),
    px: step * base,
    value: step * base,
  }));
  return [...named, ...steps];
};

export interface Snapped {
  /** The step or the named spacing it is on; null off the scale. */
  readonly name: string | null;
  readonly px: number;
  readonly value: JsonValue;
}

/**
 * Where a dragged length lands: the nearest target, a named spacing before a step of its size;
 * with ⌘/Ctrl held (`free`), the pixel. Never under 0.
 */
export const snapSpacing = (
  px: number,
  targets: readonly SpacingTarget[],
  free: boolean
): Snapped => {
  const length = Math.max(0, px);
  let best: SpacingTarget | undefined;
  if (!free) {
    for (const target of targets) {
      if (
        best === undefined ||
        Math.abs(target.px - length) < Math.abs(best.px - length)
      ) {
        best = target;
      }
    }
  }
  if (best === undefined) {
    const rounded = Math.round(length);
    return { name: null, px: rounded, value: rounded };
  }
  return { name: best.name, px: best.px, value: best.value };
};

/**
 * A gap or a padding's side in pixels: a number as it is, a token (or a step's name) as the
 * design system has it, a length in pixels or rems; 0 for none, or for what is no such length.
 */
export const spacingPx = (
  value: JsonValue | undefined,
  ds: DesignSystem | null
): number => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const ref: RegExpExecArray | null = TOKEN_REF_RE.exec(value);
  const name = ref?.[1];
  if (name === undefined) {
    return lengthPx(value) ?? 0;
  }
  const token = tokensOfKind(ds, "spacing").find((t) => t.name === name);
  if (token) {
    return lengthPx(token.value) ?? 0;
  }
  const step = spacingStepOf(name);
  return step === null ? 0 : step * spacingBasePx(ds?.spacing.base);
};

/** A padding's four sides in pixels. */
export const paddingPx = (
  value: DesignNode["padding"],
  ds: DesignSystem | null
): Record<Side, number> => {
  const sides = sidesOf(value);
  return {
    bottom: spacingPx(sides.bottom, ds),
    left: spacingPx(sides.left, ds),
    right: spacingPx(sides.right, ds),
    top: spacingPx(sides.top, ds),
  };
};

/**
 * The step or the named spacing a value is, as the pill names it: a step's pixels or its token
 * (`$spacing-4`), a named spacing's token; null for any other.
 */
export const spacingNameOf = (
  value: JsonValue | undefined,
  targets: readonly SpacingTarget[]
): string | null => {
  if (value === undefined) {
    return null;
  }
  const ref: RegExpExecArray | null =
    typeof value === "string" ? TOKEN_REF_RE.exec(value) : null;
  const name = ref?.[1];
  if (name !== undefined && spacingStepOf(name) !== null) {
    return name;
  }
  return targets.find((t) => t.value === value)?.name ?? null;
};

/** What the pill says: the field, its pixels and the step or named spacing it is on. */
export const spacingLabel = (
  field: SpacingField,
  px: number,
  name: string | null
): string => {
  const said = `${field === "gap" ? "Gap" : "Padding"} ${Math.round(px * 100) / 100}`;
  return name === null ? said : `${said} · ${name}`;
};
