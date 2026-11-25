/**
 * The token of a kind nearest to a value outside the design system: what a field offers as Use
 * nearest, and what finding a value across a canvas matches it to. Beside the token table's
 * `tokensByValue`, which finds only the tokens that hold a value exactly; it lives apart from it
 * because it reads each token in a theme (`valueInTheme`), and the themes read the token table.
 *
 * Each kind is measured in its own space: a colour in OKLab, as the distance between its L, a and
 * b (L from 0 to 1), offered only within `COLOR_NEARNESS`, where a "nearest" could plainly be
 * another colour; a length in pixels (an `em` only against another `em`); a weight and a unitless
 * line height as numbers. Lengths and numbers have no limit: the value shown beside the name says
 * how far it is. A spacing in pixels is nearest to a whole or half step of the scale on the
 * spacing base (`spacingStepAt`'s notion of a step) unless a named spacing is nearer. A font
 * family and a shadow have no measure of nearness, nor has any kind a field does not offer.
 * Between two as near, the smaller value wins; two colours as near, the first listed. Pure.
 */
import type { DesignSystem } from "./design-system.ts";
import { defaultTheme, valueInTheme } from "./themes.ts";
import { spacingBasePx, spacingStepName, tokensOfKind } from "./token-table.ts";
import {
  formatNumber,
  parseColor,
  parseLength,
  parseNumber,
  toOklab,
  toPx,
} from "./token-value.ts";
import type { TokenKind } from "./tokens.ts";

/** How far in OKLab a colour may be from a token for it to be offered as the nearest. */
export const COLOR_NEARNESS = 0.1;

/** The token nearest a value, or a step of the spacing scale, which no list holds. */
export interface NearestToken {
  /** How far it is, in its kind's measure: OKLab, pixels, or the number. */
  readonly distance: number;
  /** The token's name, or the step's (`spacing-4.5`). */
  readonly name: string;
  /** A step of the spacing scale, written as its pixels rather than as a token. */
  readonly step?: number;
  /** What it comes to in the theme, references followed: `#2563eb`, `0.5rem`, a step's `18px`. */
  readonly value: string;
}

/** A value placed in a space its distances are measured in: pixels, `em`, a number, OKLab. */
interface Point {
  readonly at: readonly number[];
  readonly space: string;
}

/** Pixels in one of each absolute unit CSS fixes, beside `px` and `rem` (`toPx`'s). */
const ABSOLUTE_PX: Readonly<Record<string, number>> = {
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
};

/**
 * A length in pixels where its unit says how many (a unitless zero is none), else in its own
 * unit, which only that unit is measured against (`em`, `%`).
 */
const lengthAt = (css: string): Point | null => {
  const px = parseNumber(css) === 0 ? 0 : toPx(css);
  if (px !== null) {
    return { at: [px], space: "px" };
  }
  const length = parseLength(css);
  if (!length) {
    return null;
  }
  const absolute = ABSOLUTE_PX[length.unit];
  return absolute === undefined
    ? { at: [length.value], space: length.unit }
    : { at: [length.value * absolute], space: "px" };
};

const numberAt = (css: string): Point | null => {
  const n = parseNumber(css);
  return n === null ? null : { at: [n], space: "number" };
};

const colorAt = (css: string): Point | null => {
  const color = parseColor(css);
  return color ? { at: toOklab(color), space: "oklab" } : null;
};

/** How each kind with a measure of nearness places a value; the kinds left out have none. */
const MEASURES: Partial<Record<TokenKind, (css: string) => Point | null>> = {
  blur: lengthAt,
  borderWidth: lengthAt,
  color: colorAt,
  container: lengthAt,
  fontSize: lengthAt,
  fontWeight: numberAt,
  leading: (css) => numberAt(css) ?? lengthAt(css),
  radius: lengthAt,
  spacing: lengthAt,
  tracking: lengthAt,
};

/** The kinds whose bare number is a number, not pixels. */
const NUMBER_KINDS: ReadonlySet<TokenKind> = new Set(["fontWeight", "leading"]);

/**
 * A design's value as a token of its kind holds it: a bare number is pixels (`18px`), but for a
 * weight or a line height (`600`); text is as it is.
 */
export const asTokenValue = (
  kind: TokenKind,
  value: string | number
): string => {
  if (typeof value === "string") {
    return value;
  }
  return NUMBER_KINDS.has(kind) ? String(value) : `${value}px`;
};

const distanceBetween = (a: Point, b: Point): number | null =>
  a.space === b.space
    ? Math.hypot(...a.at.map((n, i) => n - (b.at[i] ?? 0)))
    : null;

const EPSILON = 1e-9;

/** One that may be the nearest, placed in the value's space. */
interface Candidate {
  readonly found: NearestToken;
  readonly point: Point;
}

/** The whole or half steps of the spacing scale either side of a length in pixels. */
const stepsAround = (px: number, basePx: number): Candidate[] => {
  const halves = (px / basePx) * 2;
  const steps = new Set([Math.floor(halves) / 2, Math.ceil(halves) / 2]);
  return [...steps].map((step) => {
    const stepPx = step * basePx;
    return {
      found: {
        distance: 0,
        name: spacingStepName(step),
        step,
        value: `${formatNumber(stepPx)}px`,
      },
      point: { at: [stepPx], space: "px" },
    };
  });
};

/**
 * The token of `kind` in the design system nearest to `value` (a number is pixels, but for a
 * weight or a line height), each token read in `theme` (the default theme's when left out) with
 * the tokens it names followed; null when no token is near enough, or the kind or the value has
 * no measure of nearness.
 */
export const nearestToken = (
  kind: TokenKind,
  value: string | number,
  ds: DesignSystem,
  options: { readonly theme?: string } = {}
): NearestToken | null => {
  const measure = MEASURES[kind];
  const wanted = measure?.(asTokenValue(kind, value).trim());
  if (!(measure && wanted)) {
    return null;
  }
  const theme = options.theme ?? defaultTheme(ds);
  const tokens = tokensOfKind(ds, kind).flatMap((t): Candidate[] => {
    const comesTo = valueInTheme(ds, t.name, theme, { follow: true });
    const point = comesTo === undefined ? null : measure(comesTo.trim());
    return point && comesTo !== undefined
      ? [{ found: { distance: 0, name: t.name, value: comesTo }, point }]
      : [];
  });
  const candidates =
    kind === "spacing" && wanted.space === "px"
      ? [
          ...stepsAround(wanted.at[0] ?? 0, spacingBasePx(ds.spacing.base)),
          ...tokens,
        ]
      : tokens;
  let best: (Candidate & { readonly distance: number }) | null = null;
  for (const candidate of candidates) {
    const distance = distanceBetween(wanted, candidate.point);
    if (distance === null) {
      continue;
    }
    const nearer = best === null || distance < best.distance - EPSILON;
    // As near: the smaller value, where a value has one size.
    const smaller =
      best !== null &&
      Math.abs(distance - best.distance) <= EPSILON &&
      candidate.point.at.length === 1 &&
      (candidate.point.at[0] ?? 0) < (best.point.at[0] ?? 0);
    if (nearer || smaller) {
      best = { ...candidate, distance };
    }
  }
  if (best === null || (kind === "color" && best.distance > COLOR_NEARNESS)) {
    return null;
  }
  return { ...best.found, distance: best.distance };
};
