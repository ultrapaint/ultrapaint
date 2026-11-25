/**
 * Colours as Figma keeps them (floats 0–1, an opacity per paint) into CSS, and back into the
 * design system's tokens where a token holds that colour or blur; a shadow's CSS, for the node it
 * is on and the token its style is; and a background blur's length.
 */
import {
  blursOf,
  type DesignSystem,
} from "@ultrapaint/contracts/design-system";
import { tokensByValue, tokensOfKind } from "@ultrapaint/contracts/token-table";
import { formatNumber } from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
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

/** A node's or a style's visible effects of these types, in Figma's order. */
const visibleOf = (effects: FigNode["effects"], ...types: string[]) =>
  (Array.isArray(effects) ? effects : []).filter(
    (effect) => effect?.visible !== false && types.includes(effect?.type)
  );

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
  const shadows = visibleOf(effects, "DROP_SHADOW", "INNER_SHADOW").map(
    (effect) => {
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      const color = effect.color
        ? cssRgba(effect.color, effect.opacity ?? 1)
        : "rgba(0, 0, 0, 0.25)";
      return `${inset}${shadowPx(effect.offset?.x)} ${shadowPx(effect.offset?.y)} ${shadowPx(effect.radius)} ${shadowPx(effect.spread)} ${color}`;
    }
  );
  return shadows.length > 0 ? shadows.join(", ") : undefined;
};

/**
 * The blur behind a node, its visible background blur's radius in pixels halved, as Figma's own
 * CSS writes it (its radius draws about twice a CSS `blur()` of the same number); undefined when
 * it has none.
 */
export const backgroundBlurOf = (
  effects: FigNode["effects"]
): number | undefined => {
  const [blur] = visibleOf(effects, "BACKGROUND_BLUR");
  return blur === undefined
    ? undefined
    : Math.round(((blur.radius ?? 0) / 2) * 100) / 100;
};

/** Whether a node is blurred itself, a layer blur, which no field of the format holds. */
export const hasLayerBlur = (effects: FigNode["effects"]): boolean =>
  visibleOf(effects, "FOREGROUND_BLUR").length > 0;

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

/**
 * A colour (or a blur's length, `"12px"`) → `$token` for one a token holds; any other value as
 * it is.
 */
export type TokenMatcher = (
  value: string,
  kind?: Extract<TokenKind, "color" | "blur">
) => string;

/**
 * The token that holds a colour, or a blur's length, in whatever space or unit either is written
 * (the token table's `tokensByValue`): the first in the design system's order, semantic groups
 * coming first; a blur among the ones it offers, Tailwind's when it lists none (`blursOf`).
 */
export const makeTokenMatcher = (
  designSystem: DesignSystem | null | undefined
): TokenMatcher => {
  const byValue = tokensByValue([
    ...tokensOfKind(designSystem, "color"),
    ...blursOf(designSystem),
  ]);
  return (value, kind = "color") => {
    const [first] = byValue(kind, value);
    return first ? `$${first.name}` : value;
  };
};

export const noTokens: TokenMatcher = (value) => value;
