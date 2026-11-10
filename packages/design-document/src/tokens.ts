/**
 * Design tokens in documents. A value that starts with `$` names a Tailwind v4 theme variable
 * without its dashes: `$color-primary` is `--color-primary`, `$radius-lg` is `--radius-lg`. The
 * preview draws it as that variable, with the value the design system recorded as the fallback,
 * so a variable Tailwind left out of the stylesheet still shows; the utility it becomes in code
 * follows from the same name.
 */

import {
  APP_FROM,
  type ComponentFile,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { themeSelector } from "@ultrapaint/contracts/themes";
import { DETAILED_ROLES } from "@ultrapaint/contracts/token-presets";
import {
  allTokens,
  lineHeightName,
  SPACING_BASE,
  spacingStepOf,
  tokenKindOf,
  variableOf,
} from "@ultrapaint/contracts/token-table";
import { childrenOf } from "./tree.ts";

const TOKEN_PREFIX = "$";

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
      ? `var(${variableOf(name)})`
      : `var(${variableOf(name)}, ${fallback})`;
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
 * texts are set in, those of the system components' looks the project owns that it places, and
 * those of the app components it places, their trees included. What the code's own classes use is
 * the code's.
 */
export const tokensUsed = (
  root: DesignNode | null | undefined,
  ds: DesignSystem | null | undefined,
  components: readonly ComponentFile[] = []
): Set<string> => {
  const used = tokensIn(root);
  if (!root) {
    return used;
  }
  const styles = new Map(
    (ds?.typography.styles ?? []).map((s) => [s.name, s] as const)
  );
  const byKind = new Map<string, ComponentFile>(
    components.map(
      (c) =>
        [
          `${c.origin === "app" ? APP_FROM : SYSTEM_FROM}\0${c.name}`,
          c,
        ] as const
    )
  );
  const seen = new Set<string>();
  const visit = (node: DesignNode) => {
    if (node.type === "text" && node.textStyle) {
      tokensIn(styles.get(node.textStyle), used);
    }
    if (node.type === "instance") {
      const key = `${node.from}\0${node.component}`;
      const file = byKind.get(key);
      if (file && !seen.has(key)) {
        seen.add(key);
        tokensIn(file, used);
        if (file.origin === "app") {
          visit(file.tree);
        }
      }
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return used;
};

/**
 * In a detailed system (ADR 0062), the roles the system components read, each the detailed token
 * the preset names, where the system does not give the role a value of its own.
 */
const roleAliases = (ds: DesignSystem, names: ReadonlySet<string>) =>
  ds.tokenPreset === "detailed"
    ? Object.entries(DETAILED_ROLES).flatMap(([role, token]) =>
        names.has(token) && !names.has(role)
          ? [`  ${variableOf(role)}: var(${variableOf(token)});`]
          : []
      )
    : [];

/**
 * Every token of the design system as the custom property it is (`--color-primary`), on the
 * frame's root (`:host`, a frame being a shadow root, ADR 0042), and each other theme's values
 * under that theme (ADR 0040): the frames draw with
 * the design's values alone, the system components' look and every node's style alike. A font size's
 * line height is `--text-sm--line-height`, as Tailwind names it. A detailed system's roles are its
 * detailed tokens, and the icons' stroke is `--icon-stroke`.
 */
export const designTokenCss = (ds: DesignSystem | null | undefined): string => {
  if (!ds) {
    return "";
  }
  const tokens = allTokens(ds).filter((t) => t.value !== "");
  const names = new Set(tokens.map((t) => t.name));
  const aliases = roleAliases(ds, names);
  const base: string[] = [];
  for (const token of tokens) {
    base.push(`  ${variableOf(token.name)}: ${token.value};`);
    const { lineHeight } = token as { lineHeight?: string };
    if (lineHeight) {
      base.push(`  ${variableOf(lineHeightName(token.name))}: ${lineHeight};`);
    }
  }
  base.push(...aliases);
  if (ds.icons?.stroke !== undefined) {
    base.push(`  --icon-stroke: ${ds.icons.stroke};`);
  }
  // Every other theme declares every colour again, its own value or the default's: a token the
  // design gives in one theme only is the same in the others, never the neutral look's value
  // for that theme, which is declared on the theme's element and so wins over what it inherits.
  // A role is declared again too, so it reads the theme's token rather than the one it inherited.
  const themes = new Set([
    ...(ds.themes ?? []).slice(1),
    ...tokens.flatMap((t) => Object.keys(t.values ?? {})),
  ]);
  const themed = [...themes].map((theme) => {
    const declarations = tokens.flatMap((t) => {
      const own = t.values?.[theme];
      return own !== undefined || tokenKindOf(t.name) === "color"
        ? [`  ${variableOf(t.name)}: ${own ?? t.value};`]
        : [];
    });
    return `${themeSelector(theme)} {\n${[...declarations, ...aliases].join("\n")}\n}`;
  });
  return [
    ...(base.length > 0 ? [`:host {\n${base.join("\n")}\n}`] : []),
    ...themed,
  ].join("\n\n");
};
