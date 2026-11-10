/**
 * How a node looks, as CSS. A node's fields are given their meaning here once: `fill` and `hug`,
 * alignment on both axes, text styles, tokens. `declarationsOf` says it as declarations with
 * tokens kept by name, which a style system writes as classes (ADR 0024); `nodeStyle` is what
 * the renderer draws every node with, the same declarations with tokens as their variables.
 * Style objects are camelCased CSS properties with string values, which React and the DOM both
 * take.
 */

import type {
  DesignSystem,
  TextStyle,
} from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  Padding,
  Size,
  TextNode,
} from "@ultrapaint/contracts/document";
import type {
  Declarations,
  DeclaredValue,
} from "@ultrapaint/contracts/node-style";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import { lineHeightName } from "@ultrapaint/contracts/token-table";
import {
  isToken,
  makeTokenResolver,
  type TokenResolver,
  tokenName,
  tokenRef,
} from "./tokens.ts";

export type Style = Record<string, string>;

/** How a parent lays out its children, which is what `fill` and `hug` are relative to. */
export type ParentLayout = "row" | "column" | "block" | "free";

export interface StyleContext {
  /** Where the node sits: inside a row, a column, a group, or free (the root of a render). */
  readonly parent: ParentLayout;
  readonly resolver: TokenResolver;
  readonly textStyles: ReadonlyMap<string, TextStyle>;
}

export const makeStyleContext = (
  ds: DesignSystem | null | undefined,
  parent: ParentLayout = "free"
): StyleContext => ({
  parent,
  resolver: makeTokenResolver(ds),
  textStyles: new Map((ds?.typography.styles ?? []).map((s) => [s.name, s])),
});

export const JUSTIFY: Record<string, string> = {
  around: "space-around",
  between: "space-between",
  center: "center",
  end: "flex-end",
  start: "flex-start",
};

export const ITEMS: Record<string, string> = {
  baseline: "baseline",
  center: "center",
  end: "flex-end",
  start: "flex-start",
  stretch: "stretch",
};

const TEXT_ALIGN: Record<string, string> = {
  center: "center",
  end: "right",
  start: "left",
};

/** The layout a node gives its children. */
export const layoutOf = (node: DesignNode): ParentLayout => {
  switch (node.type) {
    case "row":
      return "row";
    case "page":
      return node.direction === "row" ? "row" : "column";
    case "column":
      return "column";
    default:
      return "block";
  }
};

interface Box {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Whether a node's children run side by side. A row and a column say so; a group or an
 * instance leaves it to its content (inline components flow in a line, a component lays out
 * what it is given as it likes), so it is read off where the first two children are drawn.
 */
export const runsInRow = (
  node: DesignNode,
  boxes: readonly (Box | null | undefined)[]
): boolean => {
  const layout = layoutOf(node);
  if (layout !== "block") {
    return layout === "row";
  }
  const [a, b] = boxes.filter((r): r is Box => Boolean(r));
  return a && b ? b.x >= a.x + a.width / 2 && b.y < a.y + a.height / 2 : false;
};

type Declared = Record<string, DeclaredValue>;

/** A page as tall as the screen: `min-h-screen` in the code, its frame on the canvas. */
const SCREEN_HEIGHT = "100vh";

/** Padding or margin, on every side at once or side by side. */
const sidesDeclared = (
  property: "padding" | "margin",
  value: Padding
): Declared => {
  if (typeof value === "number" || typeof value === "string") {
    return { [property]: value };
  }
  const out: Declared = {};
  if (value.top !== undefined) {
    out[`${property}Top`] = value.top;
  }
  if (value.right !== undefined) {
    out[`${property}Right`] = value.right;
  }
  if (value.bottom !== undefined) {
    out[`${property}Bottom`] = value.bottom;
  }
  if (value.left !== undefined) {
    out[`${property}Left`] = value.left;
  }
  return out;
};

/**
 * One axis of a node's size. Along the parent's main axis `fill` grows into the free room;
 * across it, it stretches; in a group it is the whole width or height.
 */
const sizeDeclared = (
  axis: "width" | "height",
  size: Size | undefined,
  parent: ParentLayout
): Declared => {
  if (size === undefined) {
    return {};
  }
  const main =
    (parent === "row" && axis === "width") ||
    (parent === "column" && axis === "height");
  const flex = parent === "row" || parent === "column";
  if (typeof size === "number") {
    return main ? { [axis]: size, flexShrink: "0" } : { [axis]: size };
  }
  if (size === "hug") {
    return main
      ? { [axis]: "fit-content", flexGrow: "0", flexShrink: "0" }
      : { [axis]: "fit-content", ...(flex && { alignSelf: "flex-start" }) };
  }
  if (main) {
    return {
      flexBasis: "0%",
      flexGrow: "1",
      flexShrink: "1",
      [axis === "width" ? "minWidth" : "minHeight"]: "0",
    };
  }
  return flex ? { alignSelf: "stretch" } : { [axis]: "100%" };
};

/** How a node lays out its children: a stack's flex, a tinted image's block. */
const layoutDeclared = (node: DesignNode): Declared => {
  if (node.type === "image") {
    // A span, which the reset leaves inline, unlike an image.
    return node.tint === undefined
      ? {}
      : { display: "block", maxWidth: "100%" };
  }
  if (node.type !== "page" && node.type !== "row" && node.type !== "column") {
    return {};
  }
  const out: Declared = {
    display: "flex",
    flexDirection: layoutOf(node) === "row" ? "row" : "column",
  };
  if (node.type === "page" && node.minHeight === undefined) {
    out.minHeight = SCREEN_HEIGHT;
  }
  if (node.wrap) {
    out.flexWrap = "wrap";
  }
  if (node.align) {
    out.justifyContent = JUSTIFY[node.align] ?? "flex-start";
  }
  if (node.crossAlign) {
    out.alignItems = ITEMS[node.crossAlign] ?? "stretch";
  }
  if (node.gap !== undefined) {
    out.gap = node.gap;
  }
  return out;
};

/** Size, spacing and place fields every node shares. */
const boxDeclared = (node: DesignNode, parent: ParentLayout): Declared => {
  const out: Declared = {
    ...sizeDeclared("width", node.width, parent),
    ...sizeDeclared("height", node.height, parent),
  };
  if (node.minWidth !== undefined) {
    out.minWidth = node.minWidth;
  }
  if (node.maxWidth !== undefined) {
    out.maxWidth = node.maxWidth;
  }
  if (node.minHeight !== undefined) {
    out.minHeight = node.minHeight;
  }
  if (node.maxHeight !== undefined) {
    out.maxHeight = node.maxHeight;
  }
  if (node.padding !== undefined) {
    Object.assign(out, sidesDeclared("padding", node.padding));
  }
  if (node.margin !== undefined) {
    Object.assign(out, sidesDeclared("margin", node.margin));
  }
  if (node.order !== undefined) {
    out.order = String(node.order);
  }
  return out;
};

/** Type settings: the text style first, then what the node sets itself. */
const typeSettingsOf = (node: TextNode, ctx: StyleContext) => {
  const base = node.textStyle ? ctx.textStyles.get(node.textStyle) : undefined;
  return {
    font: node.font ?? base?.font,
    lineHeight: node.lineHeight ?? base?.lineHeight,
    size: node.size ?? base?.size,
    tracking: node.tracking ?? base?.tracking,
    weight: node.weight ?? base?.weight,
  };
};

const lineHeightOf = (
  lineHeight: TextNode["lineHeight"],
  size: TextNode["size"]
): DeclaredValue | undefined => {
  if (lineHeight !== undefined) {
    // A bare number is a multiple of the font size, as in CSS, not pixels.
    return typeof lineHeight === "number" && lineHeight < 4
      ? String(lineHeight)
      : lineHeight;
  }
  // A Tailwind font size token brings the line height it is paired with.
  return size !== undefined && isToken(size)
    ? tokenRef(lineHeightName(tokenName(size)))
    : undefined;
};

const textDeclared = (node: TextNode, ctx: StyleContext): Declared => {
  const { font, lineHeight, size, tracking, weight } = typeSettingsOf(
    node,
    ctx
  );
  const out: Declared = {};
  if (font !== undefined) {
    out.fontFamily = font;
  }
  if (size !== undefined) {
    out.fontSize = size;
  }
  if (weight !== undefined) {
    out.fontWeight = typeof weight === "number" ? String(weight) : weight;
  }
  const leading = lineHeightOf(lineHeight, size);
  if (leading !== undefined) {
    out.lineHeight = leading;
  }
  if (tracking !== undefined) {
    out.letterSpacing = tracking;
  }
  if (node.color !== undefined) {
    out.color = node.color;
  }
  if (node.align) {
    out.textAlign = TEXT_ALIGN[node.align] ?? "left";
  }
  // The canvas keeps every space typed (`baseStyle`); the code asks for the line breaks.
  if (node.text.includes("\n")) {
    out.whiteSpace = "pre-wrap";
  }
  return out;
};

/** How a tinted image's file covers its box, as `fit` says of an image's pixels. */
const MASK_SIZE: Record<string, string> = {
  contain: "contain",
  cover: "cover",
  fill: "100% 100%",
};

/** Fill, border, corners, shadow and opacity; whether the node is shown at all. */
const appearanceDeclared = (node: DesignNode): Declared => {
  const out: Declared = {};
  const tint = node.type === "image" ? node.tint : undefined;
  // A tinted image is its shape filled with the tint: the file is the mask (`maskOf`).
  const fill = tint ?? node.fill;
  if (fill !== undefined) {
    out.background = fill;
  }
  if (node.border) {
    const { color, width } = node.border;
    out.borderWidth = width ?? 1;
    out.borderStyle = node.border.style ?? "solid";
    out.borderColor = color ?? "currentColor";
  }
  if (node.radius !== undefined) {
    out.borderRadius = node.radius;
  }
  if (node.shadow !== undefined) {
    out.boxShadow = node.shadow;
  }
  if (node.opacity !== undefined) {
    out.opacity = String(node.opacity);
  }
  if (node.type === "image" && tint === undefined) {
    out.objectFit = node.fit ?? "cover";
  }
  if (node.type === "image" && tint !== undefined) {
    out.maskPosition = "center";
    out.maskRepeat = "no-repeat";
    out.maskSize = MASK_SIZE[node.fit ?? "contain"] ?? "contain";
  }
  if (node.hidden) {
    out.display = "none";
  }
  return out;
};

/**
 * What a node's fields say of its look, as CSS declarations with tokens kept by name: the one
 * place the format's layout fields are given a meaning (`fill` and `hug` against the parent's
 * axis, alignment, a text style under the node's own settings, a tint). The canvas draws them
 * (`nodeStyle`) and a style system writes them as classes (`ClassWriter`). In the order the code
 * lists them: layout, size and spacing, type, then appearance.
 */
export const declarationsOf = (
  node: DesignNode,
  ctx: StyleContext
): Declarations => ({
  ...layoutDeclared(node),
  ...boxDeclared(node, ctx.parent),
  ...(node.type === "text" ? textDeclared(node, ctx) : {}),
  ...appearanceDeclared(node),
});

/**
 * What the canvas draws a node with besides its declarations, which the code leaves to the
 * application: what a reset gives an element there (Tailwind's preflight: `border-box`, no margin
 * on a text, an image a block no wider than its box), a group's `div`, the pointer of the anchor a
 * link is written as, a text's spaces kept as typed, and a page as wide as its frame.
 */
export const baseStyle = (node: DesignNode): Style => {
  const style: Style = { boxSizing: "border-box" };
  if (node.link) {
    style.cursor = "pointer";
  }
  switch (node.type) {
    case "page":
      return { ...style, width: "100%" };
    case "group":
      return { ...style, display: "block" };
    case "text":
      return { ...style, margin: "0", whiteSpace: "pre-wrap" };
    case "image":
      return node.tint === undefined
        ? { ...style, display: "block", maxWidth: "100%" }
        : style;
    default:
      return style;
  }
};

/** The style of what holds a canvas's pages: its defaults (`CanvasLayout.defaults`) as CSS. */
export const pageDefaultsStyle = (
  defaults: PageDefaults,
  ctx: Pick<StyleContext, "resolver">
): Style => {
  const { css } = ctx.resolver;
  const style: Style = {};
  if (defaults.fill !== undefined) {
    style.background = css(defaults.fill);
  }
  if (defaults.color !== undefined) {
    style.color = css(defaults.color);
  }
  if (defaults.font !== undefined) {
    style.fontFamily = css(defaults.font);
  }
  if (defaults.size !== undefined) {
    style.fontSize = css(defaults.size);
  }
  const leading = lineHeightOf(defaults.leading, defaults.size);
  if (leading !== undefined) {
    style.lineHeight = css(leading);
  }
  return style;
};

/** Declarations as the canvas draws them: a token as its variable, a number as pixels. */
const resolved = (declarations: Declarations, resolver: TokenResolver): Style =>
  Object.fromEntries(
    Object.entries(declarations).map(([property, value]) => [
      property,
      resolver.css(value),
    ])
  );

/** The inline style a node is drawn with: its declarations over what the canvas draws besides. */
export const nodeStyle = (node: DesignNode, ctx: StyleContext): Style => {
  const style = {
    ...baseStyle(node),
    ...resolved(declarationsOf(node, ctx), ctx.resolver),
  };
  // A page's frame stands for the screen: as tall as the screen is as tall as the frame.
  return node.type === "page" && style.minHeight === SCREEN_HEIGHT
    ? { ...style, minHeight: "100%" }
    : style;
};

/** The mask a tinted image is drawn with: its file, as a CSS image. */
export const maskOf = (url: string): Style => {
  const image = `url(${JSON.stringify(url)})`;
  return { maskImage: image, WebkitMaskImage: image };
};

/** The tag a node is drawn as. */
export const tagOf = (node: DesignNode): string => {
  if (node.type === "text") {
    return node.role === "heading"
      ? `h${Math.min(6, Math.max(1, node.level ?? 1))}`
      : "p";
  }
  if (node.type === "image") {
    return node.tint === undefined ? "img" : "span";
  }
  return "div";
};
