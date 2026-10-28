/**
 * Design tokens in documents. A value that starts with `$` names a Tailwind v4 theme variable
 * without its dashes: `$color-primary` is `--color-primary`, `$radius-lg` is `--radius-lg`. The
 * preview draws it as that variable, with the value the design system recorded as the fallback,
 * so a variable Tailwind left out of the stylesheet still shows; the utility it becomes in code
 * follows from the same name.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import {
  allTokens,
  lineHeightName,
  SPACING_BASE,
  spacingStepOf,
} from "@ultrapaint/contracts/token-table";
import { childrenOf } from "./tree.ts";

export const TOKEN_PREFIX = "$";

export const isToken = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(TOKEN_PREFIX);

/** `$color-primary` → `color-primary`. */
export const tokenName = (value: string): string =>
  value.slice(TOKEN_PREFIX.length);

/** `color-primary` → `$color-primary`. */
export const tokenRef = (name: string): string => `${TOKEN_PREFIX}${name}`;

/**
 * Every token the design system defines, by name, with its default value: the spacing base as
 * `spacing`, and a font size's line height as `text-sm--line-height`.
 */
export const tokenValues = (
  ds: DesignSystem | null | undefined
): Map<string, string> => {
  const values = new Map<string, string>();
  for (const token of ds ? allTokens(ds) : []) {
    values.set(token.name, token.value);
    if (token.lineHeight) {
      values.set(lineHeightName(token.name), token.lineHeight);
    }
  }
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
    const step = spacingStepOf(name);
    if (step !== null && !values.has(name)) {
      return `calc(${variable(SPACING_BASE)} * ${step})`;
    }
    return variable(name);
  };
  return { css, valueOf: (name) => values.get(name) };
};

const TOKEN_REF_RE = /^\$([a-z0-9][\w.-]*)/i;

/** Every token a value names, however deep in it: `"$color-primary"` anywhere, by name. */
export const tokensIn = (
  value: unknown,
  into: Set<string> = new Set()
): Set<string> => {
  if (typeof value === "string") {
    const found: RegExpExecArray | null = TOKEN_REF_RE.exec(value);
    const name = found ? found[1] : undefined;
    if (name) {
      into.add(name);
      // A step of the spacing scale is a multiple of `--spacing`, which is the token behind it.
      if (spacingStepOf(name) !== null) {
        into.add(SPACING_BASE);
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      tokensIn(item, into);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      tokensIn(item, into);
    }
  }
  return into;
};

/**
 * The tokens a design relies on (ADR 0028): those its nodes name, those of the text styles its
 * texts are set in, and those of the specs whose look the design owns that it places, a draft's
 * tree included. What the code's own classes use is the code's.
 */
export const tokensUsed = (
  root: DesignNode | null | undefined,
  ds: DesignSystem | null | undefined,
  specs: readonly ComponentSpec[] = []
): Set<string> => {
  const used = tokensIn(root);
  if (!root) {
    return used;
  }
  const styles = new Map(
    (ds?.typography.styles ?? []).map((s) => [s.name, s] as const)
  );
  const owned = new Map(
    specs
      .filter((s) => s.look === "design" || s.draft)
      .map((s) => [`${s.from}\0${s.component}`, s] as const)
  );
  const visit = (node: DesignNode) => {
    if (node.type === "text" && node.textStyle) {
      tokensIn(styles.get(node.textStyle), used);
    }
    if (node.type === "instance") {
      tokensIn(owned.get(`${node.from}\0${node.component}`), used);
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return used;
};
