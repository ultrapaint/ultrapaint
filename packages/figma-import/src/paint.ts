/**
 * Colours as Figma keeps them (floats 0–1, an opacity per paint) into CSS, and back into the
 * design system's tokens where a token holds that colour; and a shadow's CSS, for the node it is
 * on and the token its style is.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { tokensByValue, tokensOfKind } from "@ultrapaint/contracts/token-table";
import { formatNumber } from "@ultrapaint/contracts/token-value";
import type { FigColor, FigNode, FigPaint } from "openfig-core";

const channel = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value * 255)));

const hex2 = (value: number) => channel(value).toString(16).padStart(2, "0");

/** `#rrggbb`, or `#rrggbbaa` when the colour is not opaque. Lower case, so that it compares. */
export const cssColor = (color: FigColor, opacity = 1): string => {
  const alpha = Math.max(0, Math.min(1, color.a * opacity));
  const rgb = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  return alpha >= 0.995 ? rgb : `${rgb}${hex2(alpha)}`;
};

/** `rgba(...)` for a shadow or a gradient's stop, where a hex with alpha reads worse. */
export const cssRgba = (color: FigColor, opacity = 1): string => {
  const alpha = Math.max(0, Math.min(1, color.a * opacity));
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${Math.round(alpha * 100) / 100})`;
};

/** A length of a shadow in pixels, to a hundredth: Figma keeps `1.2` as `1.2000000476837158`. */
const shadowPx = (value: number | undefined) =>
  `${formatNumber(value ?? 0, 2)}px`;

/**
 * The visible shadows among a node's or an effect style's effects as one CSS value,
 * `0px 4px 8px 0px rgba(…)`, an inner one `inset`; undefined when there is none. The one writing
 * of it: a node's shadow and the token of a style with the same effects are the same string. An
 * effect's own opacity is in its colour's alpha.
 */
export const shadowCss = (effects: FigNode["effects"]): string | undefined => {
  const shadows = (Array.isArray(effects) ? effects : [])
    .filter(
      (effect) =>
        effect?.visible !== false &&
        (effect?.type === "DROP_SHADOW" || effect?.type === "INNER_SHADOW")
    )
    .map((effect) => {
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      const color = effect.color
        ? cssRgba(effect.color, effect.opacity ?? 1)
        : "rgba(0, 0, 0, 0.25)";
      return `${inset}${shadowPx(effect.offset?.x)} ${shadowPx(effect.offset?.y)} ${shadowPx(effect.radius)} ${shadowPx(effect.spread)} ${color}`;
    });
  return shadows.length > 0 ? shadows.join(", ") : undefined;
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
