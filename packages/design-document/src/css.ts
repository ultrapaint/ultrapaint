/**
 * How a node looks, as inline CSS. The renderer draws every node with the style this returns,
 * so this is the one place the meaning of the format's layout fields is written down: `fill`
 * and `hug`, alignment on both axes, tokens. Style objects are camelCased CSS properties with
 * string values, which React and the DOM both take.
 */

import type {
  DesignSystem,
  TextStyle,
} from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  Length,
  Padding,
  Size,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import {
  isToken,
  makeTokenResolver,
  type TokenResolver,
  tokenName,
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

const JUSTIFY: Record<string, string> = {
  around: "space-around",
  between: "space-between",
  center: "center",
  end: "flex-end",
  start: "flex-start",
};

const ITEMS: Record<string, string> = {
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
    case "column":
    case "page":
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

/** Padding or margin, on every side at once or side by side. */
const sidesStyle = (
  property: "padding" | "margin",
  value: Padding,
  css: (v: Length) => string
): Style => {
  if (typeof value === "number" || typeof value === "string") {
    return { [property]: css(value) };
  }
  const out: Style = {};
  if (value.top !== undefined) {
    out[`${property}Top`] = css(value.top);
  }
  if (value.right !== undefined) {
    out[`${property}Right`] = css(value.right);
  }
  if (value.bottom !== undefined) {
    out[`${property}Bottom`] = css(value.bottom);
  }
  if (value.left !== undefined) {
    out[`${property}Left`] = css(value.left);
  }
  return out;
};

/**
 * One axis of a node's size. Along the parent's main axis `fill` grows into the free room;
 * across it, it stretches; in a group it is the whole width or height.
 */
const sizeStyle = (
  axis: "width" | "height",
  size: Size | undefined,
  parent: ParentLayout
): Style => {
  if (size === undefined) {
    return {};
  }
  const main =
    (parent === "row" && axis === "width") ||
    (parent === "column" && axis === "height");
  const flex = parent === "row" || parent === "column";
  if (typeof size === "number") {
    return main
      ? { [axis]: `${size}px`, flexShrink: "0" }
      : { [axis]: `${size}px` };
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

/** Box, size and position fields every node shares. */
const boxStyle = (node: DesignNode, ctx: StyleContext): Style => {
  const { css } = ctx.resolver;
  const style: Style = { boxSizing: "border-box" };
  Object.assign(
    style,
    sizeStyle("width", node.width, ctx.parent),
    sizeStyle("height", node.height, ctx.parent)
  );
  if (node.minWidth !== undefined) {
    style.minWidth = css(node.minWidth);
  }
  if (node.maxWidth !== undefined) {
    style.maxWidth = css(node.maxWidth);
  }
  if (node.minHeight !== undefined) {
    style.minHeight = css(node.minHeight);
  }
  if (node.maxHeight !== undefined) {
    style.maxHeight = css(node.maxHeight);
  }
  if (node.padding !== undefined) {
    Object.assign(style, sidesStyle("padding", node.padding, css));
  }
  if (node.margin !== undefined) {
    Object.assign(style, sidesStyle("margin", node.margin, css));
  }
  if (node.fill !== undefined) {
    style.background = css(node.fill);
  }
  if (node.border) {
    const { color, width } = node.border;
    style.borderStyle = node.border.style ?? "solid";
    style.borderWidth = css(width ?? 1);
    style.borderColor = color === undefined ? "currentColor" : css(color);
  }
  if (node.radius !== undefined) {
    style.borderRadius = css(node.radius);
  }
  if (node.shadow !== undefined) {
    style.boxShadow = css(node.shadow);
  }
  if (node.opacity !== undefined) {
    style.opacity = String(node.opacity);
  }
  if (node.link) {
    style.cursor = "pointer";
  }
  if (node.hidden) {
    style.display = "none";
  }
  return style;
};

const stackStyle = (
  node: Extract<DesignNode, { type: "page" | "row" | "column" }>,
  css: (v: Length) => string
): Style => {
  const style: Style = {
    display: "flex",
    flexDirection: node.type === "row" ? "row" : "column",
  };
  if (node.gap !== undefined) {
    style.gap = css(node.gap);
  }
  if (node.align) {
    style.justifyContent = JUSTIFY[node.align] ?? "flex-start";
  }
  if (node.crossAlign) {
    style.alignItems = ITEMS[node.crossAlign] ?? "stretch";
  }
  if (node.wrap) {
    style.flexWrap = "wrap";
  }
  return style;
};

/** Type settings: the text style first, then what the node sets itself. */
export const typeSettingsOf = (node: TextNode, ctx: StyleContext) => {
  const base = node.textStyle ? ctx.textStyles.get(node.textStyle) : undefined;
  return {
    font: node.font ?? base?.font,
    lineHeight: node.lineHeight ?? base?.lineHeight,
    size: node.size ?? base?.size,
    tracking: node.tracking ?? base?.tracking,
    weight: node.weight ?? base?.weight,
  };
};

const lineHeightStyle = (
  lineHeight: TextNode["lineHeight"],
  size: TextNode["size"],
  css: (v: Length) => string
): string | undefined => {
  if (lineHeight !== undefined) {
    // A bare number is a multiple of the font size, as in CSS, not pixels.
    return typeof lineHeight === "number" && lineHeight < 4
      ? String(lineHeight)
      : css(lineHeight);
  }
  // A Tailwind font size token brings the line height it is paired with.
  return size !== undefined && isToken(size)
    ? css(`$${tokenName(size)}--line-height`)
    : undefined;
};

const textStyle = (node: TextNode, ctx: StyleContext): Style => {
  const { css } = ctx.resolver;
  const { font, lineHeight, size, tracking, weight } = typeSettingsOf(
    node,
    ctx
  );
  const style: Style = { margin: "0", whiteSpace: "pre-wrap" };
  if (size !== undefined) {
    style.fontSize = css(size);
  }
  const leading = lineHeightStyle(lineHeight, size, css);
  if (leading !== undefined) {
    style.lineHeight = leading;
  }
  if (weight !== undefined) {
    style.fontWeight =
      typeof weight === "number" ? String(weight) : css(weight);
  }
  if (font !== undefined) {
    style.fontFamily = css(font);
  }
  if (tracking !== undefined) {
    style.letterSpacing = css(tracking);
  }
  if (node.color !== undefined) {
    style.color = css(node.color);
  }
  if (node.align) {
    style.textAlign = TEXT_ALIGN[node.align] ?? "left";
  }
  return style;
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
  const leading = lineHeightStyle(defaults.leading, defaults.size, css);
  if (leading !== undefined) {
    style.lineHeight = leading;
  }
  return style;
};

/** The inline style a node is drawn with. */
export const nodeStyle = (node: DesignNode, ctx: StyleContext): Style => {
  const { css } = ctx.resolver;
  const box = boxStyle(node, ctx);
  switch (node.type) {
    case "page":
      return {
        minHeight: "100%",
        width: "100%",
        ...stackStyle(node, css),
        ...box,
      };
    case "row":
    case "column":
      return { ...stackStyle(node, css), ...box };
    case "group":
      return { display: "block", ...box };
    case "text":
      return { ...textStyle(node, ctx), ...box };
    case "image":
      return {
        display: "block",
        maxWidth: "100%",
        objectFit: node.fit ?? "cover",
        ...box,
      };
    default:
      return box;
  }
};

/** The tag a node is drawn as. */
export const tagOf = (node: DesignNode): string => {
  if (node.type === "text") {
    return node.role === "heading"
      ? `h${Math.min(6, Math.max(1, node.level ?? 1))}`
      : "p";
  }
  if (node.type === "image") {
    return "img";
  }
  return "div";
};
