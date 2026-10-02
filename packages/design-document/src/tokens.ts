/**
 * Design tokens in documents. A value that starts with `$` names a Tailwind v4 theme variable
 * without its dashes: `$color-primary` is `--color-primary`, `$radius-lg` is `--radius-lg`. The
 * preview draws it as that variable, with the value the design system recorded as the fallback,
 * so a variable Tailwind left out of the stylesheet still shows; the utility it becomes in code
 * follows from the same name.
 */
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";

export const TOKEN_PREFIX = "$";

const SPACING_STEP_RE = /^spacing-(\d+(?:\.\d+)?)$/;
const PLAIN_NUMBER_RE = /^-?[\d.]+$/;

export const isToken = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(TOKEN_PREFIX);

/** `$color-primary` → `color-primary`. */
export const tokenName = (value: string): string =>
  value.slice(TOKEN_PREFIX.length);

/** `color-primary` → `$color-primary`. */
export const tokenRef = (name: string): string => `${TOKEN_PREFIX}${name}`;

/** Every token the design system defines, by name, with its default value. */
export const tokenValues = (
  ds: DesignSystem | null | undefined
): Map<string, string> => {
  const values = new Map<string, string>();
  if (!ds) {
    return values;
  }
  const add = (tokens: readonly Token[] | undefined) => {
    for (const token of tokens ?? []) {
      values.set(token.name, token.value);
    }
  };
  for (const group of ds.colors) {
    add(group.tokens);
  }
  add(ds.radius);
  add(ds.shadows);
  add(ds.borderWidths);
  add(ds.layout?.breakpoints);
  add(ds.layout?.containers);
  add(ds.motion?.durations);
  add(ds.motion?.easings);
  add(ds.motion?.animations);
  add(ds.spacing.tokens);
  add(ds.typography.fonts);
  add(ds.typography.weights);
  add(ds.typography.leading);
  add(ds.typography.tracking);
  for (const size of ds.typography.sizes) {
    values.set(size.name, size.value);
    if (size.lineHeight) {
      values.set(`${size.name}--line-height`, size.lineHeight);
    }
  }
  values.set("spacing", ds.spacing.base);
  return values;
};

export interface TokenResolver {
  /** CSS for a value: a token becomes its variable, a number pixels, anything else stays. */
  readonly css: (value: string | number) => string;
  /** The design system's value for a token name, when it has one. */
  readonly valueOf: (name: string) => string | undefined;
}

export const makeTokenResolver = (
  ds: DesignSystem | null | undefined
): TokenResolver => {
  const values = tokenValues(ds);
  const variable = (name: string) => {
    const fallback = values.get(name);
    return fallback === undefined
      ? `var(--${name})`
      : `var(--${name}, ${fallback})`;
  };
  const css = (value: string | number): string => {
    if (typeof value === "number") {
      return `${value}px`;
    }
    if (!isToken(value)) {
      return value;
    }
    const name = tokenName(value);
    // Tailwind v4 has no variable per spacing step: `p-4` is four times `--spacing`.
    const step: RegExpExecArray | null = SPACING_STEP_RE.exec(name);
    if (step && !values.has(name)) {
      return `calc(${variable("spacing")} * ${step[1]})`;
    }
    return variable(name);
  };
  return { css, valueOf: (name) => values.get(name) };
};

/** Pixels of a CSS length the design system writes, `0.25rem` → 4; null when unknown. */
export const toPixels = (value: string, rootSize = 16): number | null => {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (value.endsWith("rem") || value.endsWith("em")) {
    return n * rootSize;
  }
  return value.endsWith("px") || PLAIN_NUMBER_RE.test(value.trim()) ? n : null;
};
