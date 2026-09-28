/**
 * Colours as Figma keeps them (floats 0–1, an opacity per paint) into CSS, and back into the
 * design system's tokens where a token has exactly that colour.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { FigColor, FigPaint } from "openfig-core";

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE =
  /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i;

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

/** A CSS colour as `#rrggbb` or `#rrggbbaa`, or null when it is not a hex or rgb colour. */
export const normaliseColor = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase();
  const hex: RegExpExecArray | null = HEX_RE.exec(trimmed);
  if (hex !== null) {
    const [, digits = ""] = hex;
    return normaliseHex(digits);
  }
  const rgb: RegExpExecArray | null = RGB_RE.exec(trimmed);
  if (rgb !== null) {
    const [, r = "0", g = "0", b = "0", a] = rgb;
    return cssColor(
      {
        a: alphaOf(a),
        b: Number(b) / 255,
        g: Number(g) / 255,
        r: Number(r) / 255,
      },
      1
    );
  }
  return null;
};

const normaliseHex = (digits: string): string | null => {
  if (digits.length === 3 || digits.length === 4) {
    return normaliseColor(`#${[...digits].map((d) => d + d).join("")}`);
  }
  if (digits.length === 6) {
    return `#${digits}`;
  }
  if (digits.length === 8) {
    return digits.endsWith("ff") ? `#${digits.slice(0, 6)}` : `#${digits}`;
  }
  return null;
};

/** The alpha of an rgb() colour: a number, a percentage, or opaque when left out. */
const alphaOf = (a: string | undefined): number => {
  if (a === undefined) {
    return 1;
  }
  return a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
};

/** Colour → `$token` for every colour token whose value is a plain hex or rgb colour. */
export type TokenMatcher = (color: string) => string;

export const makeTokenMatcher = (
  designSystem: DesignSystem | null | undefined
): TokenMatcher => {
  const byColor = new Map<string, string>();
  for (const group of designSystem?.colors ?? []) {
    for (const token of group.tokens) {
      const colour = normaliseColor(token.value);
      // The first token with a colour keeps it: semantic groups come first in the file.
      if (colour !== null && !byColor.has(colour)) {
        byColor.set(colour, `$${token.name}`);
      }
    }
  }
  return (color) => byColor.get(normaliseColor(color) ?? "") ?? color;
};

export const noTokens: TokenMatcher = (color) => color;
