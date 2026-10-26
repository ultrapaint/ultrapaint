/**
 * A node of a design as Tailwind v4 utilities (ADR 0024): the classes the inspector's Code tab
 * writes and the rules agents implement a page by (`code-rules.ts`) describe. It reads the fields
 * the way `@ultrapaint/design-document/css` draws them, and says what the canvas draws in the
 * utilities that draw the same. The JSX around the classes is the design document's own
 * (`@ultrapaint/design-document/code`), which takes this as its `ClassWriter`. Pure.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  Length,
  Padding,
  Size,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { ClassWriter } from "@ultrapaint/design-document/code";
import {
  makeStyleContext,
  type ParentLayout,
  type StyleContext,
  typeSettingsOf,
} from "@ultrapaint/design-document/css";
import {
  isToken,
  tokenName,
  toPixels,
} from "@ultrapaint/design-document/tokens";

const WHITESPACE_RE = /\s+/g;

/** Tailwind v4's own names for the font weights, which a number set in the document maps to. */
const WEIGHTS: Record<number, string> = {
  100: "thin",
  200: "extralight",
  300: "light",
  400: "normal",
  500: "medium",
  600: "semibold",
  700: "bold",
  800: "extrabold",
  900: "black",
};

/** CSS lengths that have a utility of their own. */
const LENGTH_KEYWORDS: Record<string, string> = {
  "0": "0",
  "100%": "full",
  "100dvh": "dvh",
  "100vh": "screen",
  "100vw": "screen",
  auto: "auto",
  "fit-content": "fit",
  "max-content": "max",
  "min-content": "min",
};

const COLOR_KEYWORDS: Record<string, string> = {
  black: "black",
  currentColor: "current",
  currentcolor: "current",
  inherit: "inherit",
  transparent: "transparent",
  white: "white",
};

const JUSTIFY: Record<string, string> = {
  around: "justify-around",
  between: "justify-between",
  center: "justify-center",
  end: "justify-end",
  start: "justify-start",
};

const TEXT_ALIGN: Record<string, string> = {
  center: "text-center",
  end: "text-right",
  start: "text-left",
};

/** CSS in an arbitrary value: Tailwind reads an underscore as the canvas a class cannot hold. */
const arbitrary = (prefix: string, value: string) =>
  `${prefix}-[${value.trim().replace(WHITESPACE_RE, "_")}]`;

/**
 * A token as a utility. A token of the namespace the utility reads (`$color-primary` for `bg`)
 * is the utility Tailwind generates from it, `bg-primary`; one of another namespace is still
 * the variable, `bg-(--radius-lg)`.
 */
const fromToken = (
  prefix: string,
  token: string,
  namespaces: readonly string[]
) => {
  const name = tokenName(token);
  const namespace = namespaces.find((ns) => name.startsWith(`${ns}-`));
  return namespace === undefined
    ? `${prefix}-(--${name})`
    : `${prefix}-${name.slice(namespace.length + 1)}`;
};

interface Scale {
  /** Pixels of one spacing step, `--spacing`. */
  readonly step: number;
}

/**
 * A length on the spacing scale: a number is the step it lands on (16 over a 4px base is `4`)
 * and pixels only when it is off the scale, as the briefing asks of agents.
 */
const spacing = (prefix: string, value: Length, scale: Scale): string => {
  if (typeof value === "number") {
    const steps = value / scale.step;
    // Tailwind v4 takes any quarter of a step, but past the half steps its scale has always had
    // (`p-2.5`), a value reads as off the grid, which is what brackets say.
    return Number.isInteger(steps * 2)
      ? `${prefix}-${steps}`
      : arbitrary(prefix, `${value}px`);
  }
  const keyword = LENGTH_KEYWORDS[value.trim()];
  if (keyword !== undefined) {
    return `${prefix}-${keyword}`;
  }
  return isToken(value)
    ? fromToken(prefix, value, ["spacing", "container"])
    : arbitrary(prefix, value);
};

const color = (prefix: string, value: string): string => {
  const keyword = COLOR_KEYWORDS[value.trim()];
  if (keyword !== undefined) {
    return `${prefix}-${keyword}`;
  }
  return isToken(value)
    ? fromToken(prefix, value, ["color"])
    : arbitrary(prefix, value);
};

const radius = (value: Length): string => {
  if (typeof value === "number") {
    if (value === 0) {
      return "rounded-none";
    }
    return value >= 9999 ? "rounded-full" : arbitrary("rounded", `${value}px`);
  }
  return isToken(value)
    ? fromToken("rounded", value, ["radius"])
    : arbitrary("rounded", value);
};

const shadow = (value: string): string => {
  if (value.trim() === "none") {
    return "shadow-none";
  }
  return isToken(value)
    ? fromToken("shadow", value, ["shadow"])
    : arbitrary("shadow", value);
};

/** A spacing class that may go below zero, as a margin can: `-mt-2`. */
const signedSpacing = (prefix: string, value: Length, scale: Scale): string =>
  typeof value === "number" && value < 0
    ? `-${spacing(prefix, -value, scale)}`
    : spacing(prefix, value, scale);

/** Padding (`p`) or margin (`m`): one class for every side, one per axis, else one per side. */
const sidesClasses = (
  letter: "p" | "m",
  value: Padding,
  scale: Scale
): string[] => {
  const cls = (suffix: string, v: Length) =>
    signedSpacing(`${letter}${suffix}`, v, scale);
  if (typeof value === "number" || typeof value === "string") {
    return [cls("", value)];
  }
  const { bottom, left, right, top } = value;
  const out: string[] = [];
  if (top !== undefined && top === bottom && left === top && right === top) {
    return [cls("", top)];
  }
  if (left !== undefined && left === right) {
    out.push(cls("x", left));
  } else {
    if (left !== undefined) {
      out.push(cls("l", left));
    }
    if (right !== undefined) {
      out.push(cls("r", right));
    }
  }
  if (top !== undefined && top === bottom) {
    out.push(cls("y", top));
  } else {
    if (top !== undefined) {
      out.push(cls("t", top));
    }
    if (bottom !== undefined) {
      out.push(cls("b", bottom));
    }
  }
  return out;
};

/** One axis of a node's size, as `sizeStyle` in `css.ts` draws it. */
const sizeClasses = (
  axis: "w" | "h",
  size: Size | undefined,
  parent: ParentLayout,
  scale: Scale
): string[] => {
  if (size === undefined) {
    return [];
  }
  const main =
    (parent === "row" && axis === "w") || (parent === "column" && axis === "h");
  const flex = parent === "row" || parent === "column";
  if (typeof size === "number") {
    const fixed = spacing(axis, size, scale);
    return main ? [fixed, "shrink-0"] : [fixed];
  }
  if (size === "hug") {
    if (main) {
      return [`${axis}-fit`, "shrink-0"];
    }
    return flex ? [`${axis}-fit`, "self-start"] : [`${axis}-fit`];
  }
  if (main) {
    return ["flex-1", `min-${axis}-0`];
  }
  return flex ? ["self-stretch"] : [`${axis}-full`];
};

const borderClasses = (node: DesignNode): string[] => {
  const { border } = node;
  if (!border) {
    return [];
  }
  const out: string[] = [];
  const { width } = border;
  if (width === undefined || width === 1) {
    out.push("border");
  } else if (typeof width === "number") {
    // Tailwind has a utility for a whole number of pixels only.
    out.push(
      Number.isInteger(width) && width >= 0
        ? `border-${width}`
        : arbitrary("border", `${width}px`)
    );
  } else {
    out.push(
      isToken(width)
        ? `border-(length:--${tokenName(width)})`
        : arbitrary("border", width)
    );
  }
  if (border.style === "dashed" || border.style === "dotted") {
    out.push(`border-${border.style}`);
  }
  // Left out, Tailwind v4's border is the current colour, which is what the canvas draws.
  if (border.color !== undefined) {
    out.push(color("border", border.color));
  }
  return out;
};

// ---- Typography ----

const fontSize = (value: Length): string => {
  if (typeof value === "number") {
    return arbitrary("text", `${value}px`);
  }
  return isToken(value)
    ? fromToken("text", value, ["text"])
    : arbitrary("text", `length:${value}`);
};

const lineHeight = (value: Length, scale: Scale): string => {
  // A bare number below 4 is a multiple of the font size, as in CSS and in the canvas.
  if (typeof value === "number") {
    return value < 4
      ? arbitrary("leading", String(value))
      : spacing("leading", value, scale);
  }
  return isToken(value)
    ? fromToken("leading", value, ["leading"])
    : arbitrary("leading", value);
};

const fontWeight = (value: Length): string => {
  if (typeof value === "number") {
    const name = WEIGHTS[value];
    return name === undefined
      ? arbitrary("font", String(value))
      : `font-${name}`;
  }
  return isToken(value)
    ? fromToken("font", value, ["font-weight"])
    : arbitrary("font", value);
};

const fontFamily = (value: string): string =>
  isToken(value)
    ? fromToken("font", value, ["font"])
    : arbitrary("font", `family-name:${value}`);

const tracking = (value: Length): string => {
  if (typeof value === "number") {
    return arbitrary("tracking", `${value}px`);
  }
  return isToken(value)
    ? fromToken("tracking", value, ["tracking"])
    : arbitrary("tracking", value);
};

/** A text style's settings with the node's own over them, as the canvas sets the text. */
const textClasses = (
  node: TextNode,
  ctx: StyleContext,
  scale: Scale
): string[] => {
  const settings = typeSettingsOf(node, ctx);
  const out: string[] = [];
  if (settings.font !== undefined) {
    out.push(fontFamily(settings.font));
  }
  if (settings.size !== undefined) {
    out.push(fontSize(settings.size));
  }
  if (settings.weight !== undefined) {
    out.push(fontWeight(settings.weight));
  }
  if (settings.lineHeight !== undefined) {
    out.push(lineHeight(settings.lineHeight, scale));
  }
  if (settings.tracking !== undefined) {
    out.push(tracking(settings.tracking));
  }
  if (node.color !== undefined) {
    out.push(color("text", node.color));
  }
  if (node.align) {
    out.push(TEXT_ALIGN[node.align] ?? "text-left");
  }
  // The canvas keeps the line breaks typed into the text; the application has to ask for them.
  if (node.text.includes("\n")) {
    out.push("whitespace-pre-wrap");
  }
  return out;
};

// ---- Node classes ----

const layoutClasses = (node: DesignNode, scale: Scale): string[] => {
  if (node.type !== "page" && node.type !== "row" && node.type !== "column") {
    return [];
  }
  const out = node.type === "row" ? ["flex"] : ["flex", "flex-col"];
  if (node.type === "page" && node.minHeight === undefined) {
    out.push("min-h-screen");
  }
  if (node.wrap) {
    out.push("flex-wrap");
  }
  if (node.align) {
    out.push(JUSTIFY[node.align] ?? "justify-start");
  }
  if (node.crossAlign) {
    out.push(`items-${node.crossAlign}`);
  }
  if (node.gap !== undefined) {
    out.push(spacing("gap", node.gap, scale));
  }
  return out;
};

const boxClasses = (
  node: DesignNode,
  parent: ParentLayout,
  scale: Scale
): string[] => {
  const out = [
    ...sizeClasses("w", node.width, parent, scale),
    ...sizeClasses("h", node.height, parent, scale),
  ];
  if (node.minWidth !== undefined) {
    out.push(spacing("min-w", node.minWidth, scale));
  }
  if (node.maxWidth !== undefined) {
    out.push(spacing("max-w", node.maxWidth, scale));
  }
  if (node.minHeight !== undefined) {
    out.push(spacing("min-h", node.minHeight, scale));
  }
  if (node.maxHeight !== undefined) {
    out.push(spacing("max-h", node.maxHeight, scale));
  }
  if (node.padding !== undefined) {
    out.push(...sidesClasses("p", node.padding, scale));
  }
  if (node.margin !== undefined) {
    out.push(...sidesClasses("m", node.margin, scale));
  }
  if (node.order !== undefined) {
    const { order } = node;
    out.push(order < 0 ? `-order-${-order}` : `order-${order}`);
  }
  return out;
};

const appearanceClasses = (node: DesignNode): string[] => {
  const out: string[] = [];
  if (node.fill !== undefined) {
    out.push(color("bg", node.fill));
  }
  out.push(...borderClasses(node));
  if (node.radius !== undefined) {
    out.push(radius(node.radius));
  }
  if (node.shadow !== undefined) {
    out.push(shadow(node.shadow));
  }
  if (node.opacity !== undefined) {
    out.push(`opacity-${Math.round(node.opacity * 100)}`);
  }
  if (node.type === "image") {
    out.push(`object-${node.fit ?? "cover"}`);
  }
  return out;
};

/** The utilities a node is written with, the design system's styles and scale made already. */
const classesWith = (
  node: DesignNode,
  styles: Omit<StyleContext, "parent">,
  scale: Scale,
  parent: ParentLayout
): string[] => {
  const classes = [
    ...layoutClasses(node, scale),
    ...boxClasses(node, parent, scale),
    ...(node.type === "text"
      ? textClasses(node, { ...styles, parent }, scale)
      : []),
    ...appearanceClasses(node),
  ];
  return [...new Set(classes)];
};

/** The utilities a node is written with: layout, size, spacing, type, then appearance. */
export const classesOf = (
  node: DesignNode,
  ds: DesignSystem | null | undefined,
  parent: ParentLayout = "free"
): string[] =>
  classesWith(node, makeStyleContext(ds), { step: spacingStep(ds) }, parent);

const spacingStep = (ds: DesignSystem | null | undefined) => {
  const step = toPixels(ds?.spacing.base ?? "0.25rem");
  return step && step > 0 ? step : 4;
};

/** Tailwind's own font sizes, which `text-*` names beside the design system's. */
const FONT_SIZES = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const WEIGHT_NAMES = new Set(Object.values(WEIGHTS));
const DISPLAY_RE = /^(?:flex|hidden|block|inline|inline-flex|grid|contents)$/;
const DIRECTION_RE = /^flex-(?:row|col)(?:-reverse)?$/;
const WRAP_RE = /^flex-(?:wrap|nowrap|wrap-reverse)$/;
const FLEX_RE = /^flex-(?:\d+|auto|initial|none)$/;
const TEXT_ALIGN_RE = /^text-(?:left|center|right|justify|start|end)$/;
const BORDER_STYLE_RE = /^border-(?:solid|dashed|dotted|double|none)$/;
const BORDER_WIDTH_RE = /^border(?:-\d+|-\(length:.*|-\[\d.*)?$/;
const ARBITRARY_NUMBER_RE = /^[a-z-]+-\[(?:length:|\d|\.)/;
const ORDER_RE = /^-?order-/;
const VALUE_START_RE = /-(?:\[|\()/;
const LEADING_DASH_RE = /^-/;

/** Utilities whose name alone says what they set, whatever their prefix shares. */
const FIXED_GROUPS: readonly (readonly [RegExp, string])[] = [
  [DISPLAY_RE, "display"],
  [DIRECTION_RE, "flex-direction"],
  [WRAP_RE, "flex-wrap"],
  [FLEX_RE, "flex"],
  [ORDER_RE, "order"],
  [TEXT_ALIGN_RE, "text-align"],
  [BORDER_STYLE_RE, "border-style"],
];

/** `text-lg` is a size, `text-primary` a colour. */
const textGroup = (cls: string, sizes: ReadonlySet<string>) =>
  sizes.has(cls.slice(5)) || ARBITRARY_NUMBER_RE.test(cls)
    ? "font-size"
    : "text-color";

/** `font-bold` is a weight, `font-sans` a family. */
const fontGroup = (cls: string) => {
  const value = cls.slice(5);
  return WEIGHT_NAMES.has(value) ||
    value.startsWith("weight-") ||
    value.startsWith("(--font-weight") ||
    ARBITRARY_NUMBER_RE.test(cls)
    ? "font-weight"
    : "font-family";
};

/** A class's name up to its value: `gap-4` → `gap`, `-mt-2` → `mt`. */
const prefixGroup = (cls: string) => {
  // A negative margin is the same group as the margin: `-mt-2`, `mt-4`.
  const head = (cls.split(VALUE_START_RE)[0] ?? cls).replace(
    LEADING_DASH_RE,
    ""
  );
  const dash = head.lastIndexOf("-");
  return dash > 0 ? head.slice(0, dash) : head;
};

/**
 * What a class sets, as one name for every value of it (ADR 0036): `md:gap-6` takes over from
 * `gap-4`, and `flex-wrap` does not from `flex-col`. The utilities whose prefix is shared by
 * several properties (`flex-*`, `text-*`, `font-*`, `border-*`) are told apart here.
 */
const groupOf = (sizes: ReadonlySet<string>) => (cls: string) => {
  const fixed = FIXED_GROUPS.find(([re]) => re.test(cls));
  if (fixed) {
    return fixed[1];
  }
  if (cls.startsWith("text-")) {
    return textGroup(cls, sizes);
  }
  if (cls.startsWith("font-")) {
    return fontGroup(cls);
  }
  if (cls === "border" || cls.startsWith("border-")) {
    return BORDER_WIDTH_RE.test(cls) ? "border-width" : "border-color";
  }
  return prefixGroup(cls);
};

/** How Tailwind v4 writes a design's nodes, its styles and spacing step made once. */
export const tailwindClasses = (
  ds: DesignSystem | null | undefined
): ClassWriter => {
  const styles = makeStyleContext(ds);
  const scale = { step: spacingStep(ds) };
  const sizes = new Set([
    ...FONT_SIZES,
    ...(ds?.typography.sizes ?? []).map((t) =>
      t.name.startsWith("text-") ? t.name.slice(5) : t.name
    ),
  ]);
  return {
    classes: (node, parent) => classesWith(node, styles, scale, parent),
    group: groupOf(sizes),
    // A column that stretches the component across, as the canvas draws it.
    wrapper: (classes) => ["flex", "flex-col", ...classes],
  };
};
