/**
 * The front matter the code implies (ADR 0027): the design system's colours, radii, spacing and
 * text styles, with the code's values in the default theme, written as the format holds them.
 * Other themes stay in the code; the body says how they differ.
 */
import type {
  DesignSystem,
  TextStyle,
  Token,
} from "@ultrapaint/contracts/design-system";
import {
  isToken,
  tokenName,
  tokenValues,
} from "@ultrapaint/design-document/tokens";
import type { TokenGroups, Typography } from "./format.ts";
import { tokenKeyOf } from "./tokens.ts";
import {
  familyOf,
  formatNumber,
  isColor,
  isDimension,
  isPlainNumber,
  resolveCss,
} from "./values.ts";

/** The font a text style without one is set in: Tailwind's, on the body. */
const BODY_FONT = "font-sans";

/** A bare line height below this is a multiple of the font size, as the renderer reads it. */
const MAX_LINE_HEIGHT_FACTOR = 4;

export interface Mirror {
  readonly groups: TokenGroups;
  /** What was left out because the format cannot hold it, a line each. */
  readonly notes: readonly string[];
}

const textStyleKey = (style: TextStyle) => tokenKeyOf(style.name);

/**
 * The tokens named `<prefix>-<key>`, by key, with the values `accept` takes once resolved;
 * what it does not take is said in `notes`.
 */
const groupOf = <A>(
  tokens: readonly Token[],
  prefix: string,
  resolve: (name: string, value: string) => string | null,
  accept: (value: string) => A | null,
  wanted: string,
  notes: string[]
): Record<string, A> => {
  const out: Record<string, A> = {};
  for (const token of tokens) {
    if (!token.name.startsWith(prefix)) {
      continue;
    }
    const resolved = resolve(token.name, token.value);
    const value = resolved === null ? null : accept(resolved);
    if (value !== null) {
      out[token.name.slice(prefix.length)] = value;
    } else if (resolved !== null) {
      notes.push(`${token.name}: ${resolved} is not ${wanted}.`);
    }
  }
  return out;
};

const LENGTH = "a length in px, em or rem";
const lengthOf = (value: string) => (isDimension(value) ? value : null);
const spacingOf = (value: string): number | string | null => {
  if (isDimension(value)) {
    return value;
  }
  return isPlainNumber(value) ? Number(value) : null;
};

/**
 * The front matter's mirrored groups for a design system whose values are the code's (the
 * service merges them in on read).
 */
export const mirrorOf = (ds: DesignSystem): Mirror => {
  const values = tokenValues(ds);
  const notes: string[] = [];
  const resolve = (name: string, value: string): string | null => {
    const resolved = resolveCss(value, (n) => values.get(n));
    if (resolved === null) {
      notes.push(`${name}: ${value} does not resolve to a value.`);
    }
    return resolved;
  };
  const group = <A>(
    tokens: readonly Token[],
    prefix: string,
    accept: (value: string) => A | null,
    wanted: string
  ) => groupOf(tokens, prefix, resolve, accept, wanted, notes);

  const colors = group(
    ds.colors.flatMap((g) => g.tokens),
    "color-",
    (value) => (isColor(value) ? value : null),
    "a colour DESIGN.md can hold"
  );
  const rounded = group(ds.radius, "radius-", lengthOf, LENGTH);
  const spacing = group(
    [
      { name: "spacing-base", value: ds.spacing.base },
      ...(ds.spacing.tokens ?? []),
    ],
    "spacing-",
    spacingOf,
    LENGTH
  );

  const typography: Record<string, Typography> = {};
  for (const style of ds.typography.styles) {
    const settings = typographyOf(style, values, notes);
    if (Object.keys(settings).length > 0) {
      typography[textStyleKey(style)] = settings;
    }
  }

  return { groups: { colors, rounded, spacing, typography }, notes };
};

/** A setting of a text style as CSS: a token's value, a number of pixels, or the CSS it is. */
const settingOf = (
  setting: number | string,
  values: ReadonlyMap<string, string>
): string | null => {
  if (typeof setting === "number") {
    return `${formatNumber(setting)}px`;
  }
  const raw = isToken(setting) ? values.get(tokenName(setting)) : setting;
  return raw === undefined ? null : resolveCss(raw, (name) => values.get(name));
};

const typographyOf = (
  style: TextStyle,
  values: ReadonlyMap<string, string>,
  notes: string[]
): Typography => {
  const out: Record<string, number | string> = {};
  const where = `text style ${style.name}`;
  const length = (field: string, setting: number | string | undefined) => {
    if (setting === undefined) {
      return;
    }
    const value = settingOf(setting, values);
    if (value !== null && isDimension(value)) {
      out[field] = value;
    } else {
      notes.push(`${where}: its ${field} ${String(setting)} is not a length.`);
    }
  };

  const font =
    style.font ?? (values.has(BODY_FONT) ? `$${BODY_FONT}` : undefined);
  if (font !== undefined) {
    const stack = settingOf(font, values);
    const family = stack === null ? null : familyOf(stack);
    if (family !== null) {
      out.fontFamily = family;
    }
  }
  length("fontSize", style.size);

  if (style.weight !== undefined) {
    const weight =
      typeof style.weight === "number"
        ? String(style.weight)
        : settingOf(style.weight, values);
    if (weight !== null && isPlainNumber(weight)) {
      out.fontWeight = Number(weight);
    } else {
      notes.push(
        `${where}: its weight ${String(style.weight)} is not a number.`
      );
    }
  }

  const leading = lineHeightOf(style, values);
  if (leading !== null) {
    out.lineHeight = leading;
  }
  length("letterSpacing", style.tracking);
  return out as Typography;
};

/** The style's line height, or the one its size token is paired with; null when neither reads. */
const lineHeightOf = (
  style: TextStyle,
  values: ReadonlyMap<string, string>
): number | string | null => {
  const { lineHeight, size } = style;
  if (typeof lineHeight === "number") {
    return lineHeight < MAX_LINE_HEIGHT_FACTOR
      ? lineHeight
      : `${formatNumber(lineHeight)}px`;
  }
  const raw =
    lineHeight ??
    (size !== undefined && isToken(size)
      ? `$${tokenName(size)}--line-height`
      : undefined);
  if (raw === undefined) {
    return null;
  }
  const value = settingOf(raw, values);
  if (value === null) {
    return null;
  }
  if (isPlainNumber(value)) {
    return Number(formatNumber(Number(value)));
  }
  return isDimension(value) ? value : null;
};
