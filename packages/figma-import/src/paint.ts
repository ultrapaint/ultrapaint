/**
 * Colours as Figma keeps them (floats 0–1, an opacity per paint) into CSS, and back into the
 * design system's tokens where a token holds that colour.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { tokensByValue, tokensOfKind } from "@ultrapaint/contracts/token-table";
import type { FigColor, FigPaint } from "openfig-core";

const channel = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value * 255)));

const hex2 = (value: number) => channel(value).toString(16).padStart(2, "0");

/** `#rrggbb`, or `#rrggbbaa` when the colour is not opaque. Lower case, so that it compares. */
export const cssColor = (color: FigColor, opacity = 1): string => {
  const alpha = Math.max(0, Math.min(1, color.a * opacity));
  const rgb = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  return alpha >= 0.995 ? rgb : `${rgb}${hex2(alpha)}`;
};

/** `rgba(...)` for a shadow, where a hex with alpha reads worse. */
export const cssRgba = (color: FigColor, opacity = 1): string => {
  const alpha = Math.max(0, Math.min(1, color.a * opacity));
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${Math.round(alpha * 100) / 100})`;
};

/** The first visible paint of a kind, in the order Figma draws them (last on top). */
export const topPaint = (
  paints: readonly FigPaint[] | undefined,
  type: string
): FigPaint | undefined =>
  [...(paints ?? [])]
    .reverse()
    .find((paint) => paint.visible !== false && paint.type === type);

/** The colour of the topmost solid paint, or undefined when there is none. */
export const solidColor = (
  paints: readonly FigPaint[] | undefined
): string | undefined => {
  const paint = topPaint(paints, "SOLID");
  return paint?.color ? cssColor(paint.color, paint.opacity ?? 1) : undefined;
};

/** Colour → `$token` for a colour a token holds; any other colour as it is. */
export type TokenMatcher = (color: string) => string;

/**
 * The colour token that holds a colour, in whatever space either is written (the token table's
 * `tokensByValue`): the first in the design system's order, semantic groups coming first.
 */
export const makeTokenMatcher = (
  designSystem: DesignSystem | null | undefined
): TokenMatcher => {
  const byValue = tokensByValue(tokensOfKind(designSystem, "color"));
  return (color) => {
    const [first] = byValue("color", color);
    return first ? `$${first.name}` : color;
  };
};

export const noTokens: TokenMatcher = (color) => color;
