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
import type { FigNode } from "openfig-core";
import { cssRgba, solidColor, type TokenMatcher, topPaint } from "./paint.ts";

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

const shadowOf = (node: FigNode): string | undefined => {
  const shadows = ((node.effects ?? []) as NonNullable<FigNode["effects"]>)
    .filter(
      (effect) =>
        effect.visible !== false &&
        (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW")
    )
    .map((effect) => {
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      const color = effect.color
        ? cssRgba(effect.color, effect.opacity ?? 1)
        : "rgba(0, 0, 0, 0.25)";
      return `${inset}${round(effect.offset?.x ?? 0)}px ${round(effect.offset?.y ?? 0)}px ${round(effect.radius ?? 0)}px ${round(effect.spread ?? 0)}px ${color}`;
    });
  return shadows.length > 0 ? shadows.join(", ") : undefined;
};

const fillOf = (node: FigNode, tokens: TokenMatcher): string | undefined => {
  const paint = topPaint(node.fillPaints, "SOLID");
  if (paint?.color) {
    return tokens(solidColor([paint]) ?? "");
  }
  const gradient = topPaint(node.fillPaints, "GRADIENT_LINEAR");
  if (gradient?.stops && gradient.stops.length > 0) {
    const stops = gradient.stops
      .map(
        (stop) =>
          `${cssRgba(stop.color, gradient.opacity ?? 1)} ${round(stop.position * 100)}%`
      )
      .join(", ");
    return `linear-gradient(180deg, ${stops})`;
  }
  return undefined;
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
    shadow: shadowOf(node),
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
