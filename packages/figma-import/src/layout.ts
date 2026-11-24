/**
 * The box of a node: its size on each axis as Figma's sizing and the parent's layout decide
 * it, its padding, fill, border, radius and shadow.
 */
import type {
  Border,
  Padding,
  Sides,
  Size,
} from "@ultrapaint/contracts/document";
import {
  fillCss,
  type GradientLayer,
  type GradientShape,
} from "@ultrapaint/design-document/fill";
import {
  type FigNode,
  type FigPaint,
  type FigTransform,
  type ResolvedRadialGradientGeometry,
  resolveGradientGeometry,
} from "openfig-core";
import {
  cssRgba,
  shadowCss,
  solidColor,
  type TokenMatcher,
  topPaint,
} from "./paint.ts";

export type Direction = "row" | "column" | null;

/** Where a node sits: the layout of its parent decides how its size is read. */
export interface Placement {
  readonly direction: Direction;
}

export interface OwnSize {
  readonly height: Size | undefined;
  readonly width: Size | undefined;
}

export const round = (value: number) => Math.round(value * 100) / 100;

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;

export const paddingOf = (node: FigNode): Padding | undefined => {
  const left = node.stackHorizontalPadding ?? node.stackPadding ?? 0;
  const top = node.stackVerticalPadding ?? node.stackPadding ?? 0;
  const right = node.stackPaddingRight ?? left;
  const bottom = node.stackPaddingBottom ?? top;
  if (left === 0 && top === 0 && right === 0 && bottom === 0) {
    return undefined;
  }
  if (left === top && top === right && right === bottom) {
    return round(left);
  }
  const sides: Sides = {
    bottom: round(bottom),
    left: round(left),
    right: round(right),
    top: round(top),
  };
  return sides;
};

const radiusOf = (node: FigNode): number | string | undefined => {
  if (node.rectangleCornerRadiiIndependent === true) {
    const corners = [
      node.rectangleTopLeftCornerRadius,
      node.rectangleTopRightCornerRadius,
      node.rectangleBottomRightCornerRadius,
      node.rectangleBottomLeftCornerRadius,
    ].map((corner: number | undefined) => round(corner ?? 0));
    return corners.every((corner) => corner === 0)
      ? undefined
      : corners.map((corner) => `${corner}px`).join(" ");
  }
  return node.cornerRadius ? round(node.cornerRadius) : undefined;
};

const borderOf = (node: FigNode, tokens: TokenMatcher): Border | undefined => {
  const stroke = topPaint(node.strokePaints, "SOLID");
  const width = node.strokeWeight ?? 0;
  if (!stroke?.color || width <= 0) {
    return undefined;
  }
  const dashed = ((node.dashPattern ?? []) as number[]).some((d) => d > 0);
  return compact({
    color: tokens(solidColor([stroke]) ?? ""),
    style: dashed ? ("dashed" as const) : undefined,
    width: round(width),
  });
};

/** The kinds of gradient a fill brings, as the shape CSS draws each with (ADR 0134). */
const GRADIENTS: Record<string, GradientShape> = {
  GRADIENT_ANGULAR: "conic",
  GRADIENT_LINEAR: "linear",
  GRADIENT_RADIAL: "radial",
};

const IDENTITY: FigTransform = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
};

/** Degrees clockwise from up, as CSS gives a gradient's direction, from 0 to 360. */
const cssDegrees = (dx: number, dy: number) =>
  round(((((Math.atan2(dx, -dy) * 180) / Math.PI) % 360) + 360) % 360);

/**
 * An ellipse's radii along the box's axes, as CSS gives a radial gradient's size: a CSS ellipse
 * cannot turn, so one Figma turned is the ellipse its turned one spans (exact on a quarter turn,
 * whose radii swap).
 */
const radiiOf = (
  ellipse: Pick<
    ResolvedRadialGradientGeometry,
    "angle" | "radiusX" | "radiusY"
  >,
  width: number,
  height: number
) => {
  const { angle, radiusX, radiusY } = ellipse;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const across = Math.hypot(radiusX * cos, radiusY * sin);
  const down = Math.hypot(radiusX * sin, radiusY * cos);
  return `${percent(across / width)} ${percent(down / height)}`;
};

/** A share of a gradient as CSS writes a stop's position, `40%`. */
const percent = (share: number) => `${round(share * 100)}%`;

/**
 * How a gradient paint runs over a box of `width` by `height` as CSS says it, from the paint's
 * transform: a linear one's angle, with where its handles' ends fall on CSS's gradient line (CSS
 * runs a gradient corner to corner, Figma between its handles); a radial one as an ellipse at
 * its centre; an angular one as a conic gradient from its start handle.
 */
const gradientGeometry = (
  shape: GradientShape,
  transform: FigTransform,
  width: number,
  height: number
): {
  readonly head: Partial<GradientLayer>;
  readonly at: (s: number) => number;
} => {
  const geometry = resolveGradientGeometry(
    { transform, type: shape === "linear" ? "linear" : "radial" },
    width,
    height
  );
  if (geometry?.type === "linear") {
    const { end, start } = geometry;
    const angle = cssDegrees(end.x - start.x, end.y - start.y);
    const rad = (angle * Math.PI) / 180;
    const [ux, uy] = [Math.sin(rad), -Math.cos(rad)];
    const length = Math.abs(width * ux) + Math.abs(height * uy);
    const along = (p: { x: number; y: number }) =>
      ((p.x - width / 2) * ux + (p.y - height / 2) * uy) / length + 0.5;
    const [from, to] = [along(start), along(end)];
    return { at: (s) => from + s * (to - from), head: { angle } };
  }
  if (geometry?.type === "radial") {
    const { angle, center } = geometry;
    const centre = `at ${percent(center.x / width)} ${percent(center.y / height)}`;
    return {
      at: (s) => s,
      head:
        shape === "conic"
          ? {
              angle: cssDegrees(Math.cos(angle), Math.sin(angle)),
              geometry: centre,
            }
          : {
              geometry: `${radiiOf(geometry, width, height)} ${centre}`,
            },
    };
  }
  return { at: (s) => s, head: shape === "linear" ? { angle: 180 } : {} };
};

/**
 * A gradient paint as CSS: its shape, how it runs, and its stops, each the colour token that
 * holds its colour where the design system has one.
 */
const gradientOf = (
  node: FigNode,
  paint: FigPaint,
  tokens: TokenMatcher
): string | undefined => {
  const shape = GRADIENTS[paint.type];
  if (!(shape && paint.stops && paint.stops.length > 0)) {
    return undefined;
  }
  const { at, head } = gradientGeometry(
    shape,
    paint.transform ?? IDENTITY,
    node.size?.x ?? 1,
    node.size?.y ?? 1
  );
  const stops = [...paint.stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => ({
      color: tokens(cssRgba(stop.color, paint.opacity ?? 1)),
      position: percent(at(stop.position)),
    }));
  return fillCss([{ ...head, kind: "gradient", shape, stops }]) ?? undefined;
};

const fillOf = (node: FigNode, tokens: TokenMatcher): string | undefined => {
  const paint = topPaint(node.fillPaints, "SOLID");
  if (paint?.color) {
    return tokens(solidColor([paint]) ?? "");
  }
  const gradient = [...(node.fillPaints ?? [])]
    .reverse()
    .find((p) => p.visible !== false && GRADIENTS[p.type] !== undefined);
  return gradient ? gradientOf(node, gradient, tokens) : undefined;
};

/** How a node is sized on each axis: its own sizing, unless its parent's layout stretches it. */
export const sizeOf = (
  node: FigNode,
  placement: Placement,
  own: OwnSize
): OwnSize => {
  const { direction } = placement;
  const grow = direction !== null && node.stackChildPrimaryGrow === 1;
  const stretch = direction !== null && node.stackChildAlignSelf === "STRETCH";
  const fillsWidth = direction === "row" ? grow : stretch;
  const fillsHeight = direction === "row" ? stretch : grow;
  return {
    height: fillsHeight ? "fill" : own.height,
    width: fillsWidth ? "fill" : own.width,
  };
};

export const fixedSize = (node: FigNode): OwnSize => ({
  height: node.size ? round(node.size.y) : undefined,
  width: node.size ? round(node.size.x) : undefined,
});

const hugs = (sizing: string | undefined) =>
  sizing !== undefined && sizing !== "FIXED";

/** A frame's own sizing: fixed to its size, or hugging its content on either axis. */
export const frameSize = (node: FigNode): OwnSize => {
  const fixed = fixedSize(node);
  if (!node.stackMode || node.stackMode === "NONE") {
    return fixed;
  }
  const primaryHugs = hugs(node.stackPrimarySizing);
  const counterHugs = hugs(node.stackCounterSizing);
  const horizontal = node.stackMode === "HORIZONTAL";
  return {
    height: (horizontal ? counterHugs : primaryHugs) ? "hug" : fixed.height,
    width: (horizontal ? primaryHugs : counterHugs) ? "hug" : fixed.width,
  };
};

/** The box fields every node has, without the ones that are undefined. */
export const boxOf = (
  node: FigNode,
  placement: Placement,
  own: OwnSize,
  tokens: TokenMatcher
) =>
  compact({
    ...sizeOf(node, placement, own),
    border: borderOf(node, tokens),
    fill: fillOf(node, tokens),
    name: node.name || undefined,
    opacity:
      node.opacity !== undefined && node.opacity < 1
        ? round(node.opacity)
        : undefined,
    radius: radiusOf(node),
    shadow: shadowCss(node.effects),
  });

const mainAlign = (value: string | undefined) => {
  switch (value) {
    case "CENTER":
      return "center" as const;
    case "MAX":
      return "end" as const;
    case "SPACE_BETWEEN":
      return "between" as const;
    case "SPACE_EVENLY":
      return "around" as const;
    default:
      return;
  }
};

const crossAlign = (value: string | undefined) => {
  switch (value) {
    case "CENTER":
      return "center" as const;
    case "MAX":
      return "end" as const;
    case "BASELINE":
      return "baseline" as const;
    default:
      return;
  }
};

/** A row's or column's gap, alignment and wrap. */
export const stackFields = (node: FigNode) => {
  const between = node.stackPrimaryAlignItems === "SPACE_BETWEEN";
  return {
    align: mainAlign(node.stackPrimaryAlignItems),
    crossAlign: crossAlign(node.stackCounterAlignItems),
    gap: !between && node.stackSpacing ? round(node.stackSpacing) : undefined,
    wrap: node.stackWrap === "WRAP" ? true : undefined,
  };
};
