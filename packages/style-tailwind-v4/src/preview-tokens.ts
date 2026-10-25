/**
 * The design's token values in the preview (ADR 0028). The repository's components read the
 * code's variables, so the preview is given a stylesheet, unlayered and after the code's, that
 * sets those variables to the design's values. It is written where the code writes them: an
 * `@theme inline` alias (`--color-primary: var(--primary)`) is followed to the variable that
 * holds the value, set under the selector each theme gives it (`:root`, `.dark`,
 * `[data-theme="x"]`). A token declared straight in `@theme`, or not declared at all, is its own
 * variable, `--color-brand`.
 */
import type { DesignTokenValue } from "@ultrapaint/contracts/tokens";
import type { DesignSystemContext } from "@ultrapaint/framework-api/node";
import type { Block, Declaration } from "./stylesheet.ts";
import {
  aliasOf,
  isTheme,
  type Reading,
  read,
  selectorOf,
  themeKeyOf,
} from "./tokens.ts";

/** Where a declaration goes: a selector, inside the at-rules that wrap it, outermost first. */
interface Scope {
  readonly selector: string;
  readonly wrappers: readonly string[];
}

/** A declaration to write, and where. */
interface Entry {
  readonly scope: Scope;
  readonly theme: string;
  readonly value: string;
  readonly variable: string;
}

const WRAPPER_RE = /^@(?:media|supports|container)\b/;
const LAYER_RE = /^@layer\b/;
const BRACES_RE = /[{}]/;

const ROOT: Scope = { selector: ":root", wrappers: [] };

/**
 * The scope a block of the code is written in, as plain CSS can say it again: its `@layer` left
 * out, since the override is unlayered, its `@media` kept. Null for a block only Tailwind reads
 * (`@variant dark`, `@theme`) or one nested with `&`.
 */
const scopeOfBlock = (blocks: readonly Block[], block: Block): Scope | null => {
  const chain = blocks
    .filter(
      (b) =>
        b.file === block.file && b.open < block.open && b.close > block.close
    )
    .sort((a, b) => a.open - b.open);
  const wrappers: string[] = [];
  const selectors: string[] = [];
  let outer = "";
  for (const b of [...chain, block]) {
    const segment = b.prelude.slice(outer.length).trim();
    outer = b.prelude;
    if (LAYER_RE.test(segment)) {
      continue;
    }
    if (WRAPPER_RE.test(segment)) {
      wrappers.push(segment);
    } else if (segment.startsWith("@") || segment.includes("&")) {
      return null;
    } else {
      selectors.push(segment);
    }
  }
  if (
    selectors.length === 0 ||
    (selectors.length > 1 && selectors.some((s) => s.includes(",")))
  ) {
    return null;
  }
  return { selector: selectors.join(" "), wrappers };
};

const scopeOfDeclaration = (
  reading: Reading,
  decl: Declaration
): Scope | null => {
  const block = reading.blocks.find(
    (b) => b.file === decl.file && b.open === decl.block
  );
  return block ? scopeOfBlock(reading.blocks, block) : null;
};

/**
 * The scope a theme's new value goes in: the block the code gives the theme's variables, else
 * the selector a new theme block is written under.
 */
const themeScopeOf = (reading: Reading, theme: string): Scope => {
  if (theme === "") {
    return ROOT;
  }
  const [first] = reading.scoped.get(theme)?.values() ?? [];
  const scope =
    first && !isTheme(first.prelude) && themeKeyOf(first.prelude) === theme
      ? scopeOfDeclaration(reading, first)
      : null;
  return scope ?? { selector: selectorOf(theme), wrappers: [] };
};

/**
 * The variable that holds a token's value: the one an alias names when the code gives it a
 * value in some theme's block, as the token reader follows it; else the token's own.
 */
const variableOf = (reading: Reading, name: string): string => {
  const decl = reading.declared.get(name);
  const alias = decl ? aliasOf(decl.value) : undefined;
  const held =
    alias !== undefined &&
    [...reading.scoped.values()].some((vars) => vars.has(alias));
  return held && alias ? alias : `--${name}`;
};

/** Code-point order, the same on every machine. */
const compare = (a: string, b: string) => (a < b ? -1 : Number(a > b));

const keyOf = (scope: Scope) => [...scope.wrappers, scope.selector].join(" ");

const indent = (css: string) =>
  css
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const render = (scope: Scope, declarations: ReadonlyMap<string, string>) => {
  const body = [...declarations]
    .sort(([a], [b]) => compare(a, b))
    .map(([variable, value]) => `  ${variable}: ${value};`)
    .join("\n");
  return scope.wrappers.reduceRight(
    (css, wrapper) => `${wrapper} {\n${indent(css)}\n}`,
    `${scope.selector} {\n${body}\n}`
  );
};

/**
 * The stylesheet that draws the repository's components with the design's values: one rule per
 * selector, the default theme's first, then each theme's in the order the code has them.
 *
 * A variable given a value in the default theme that the code also sets in a theme's block is
 * set there again, to the design's value for that theme or, when the design gives none, to the
 * code's: the default's rule comes after the code's theme blocks, and where the theme's selector
 * is no more specific (`.dark` on the root element), it would win in that theme too.
 */
export const previewTokenCss = (
  ctx: DesignSystemContext,
  tokens: readonly DesignTokenValue[]
): string => {
  const reading = read(ctx);
  const entries = new Map<string, Entry>();
  for (const token of tokens) {
    if (token.value.trim() === "" || BRACES_RE.test(token.value)) {
      continue;
    }
    const theme = token.theme ?? "";
    const variable = variableOf(reading, token.name);
    const holder = reading.scoped.get(theme)?.get(variable);
    const scope =
      (holder && scopeOfDeclaration(reading, holder)) ??
      themeScopeOf(reading, theme);
    entries.set(`${theme}|${variable}`, {
      scope,
      theme,
      value: token.value.trim(),
      variable,
    });
  }
  for (const entry of [...entries.values()]) {
    if (entry.theme !== "") {
      continue;
    }
    for (const [theme, vars] of reading.scoped) {
      const holder = vars.get(entry.variable);
      if (
        theme === "" ||
        holder === undefined ||
        entries.has(`${theme}|${entry.variable}`)
      ) {
        continue;
      }
      entries.set(`${theme}|${entry.variable}`, {
        scope:
          scopeOfDeclaration(reading, holder) ?? themeScopeOf(reading, theme),
        theme,
        value: holder.value,
        variable: entry.variable,
      });
    }
  }

  const { themes } = reading.source;
  const rank = (theme: string) => {
    if (theme === "") {
      return -1;
    }
    const at = themes.indexOf(theme);
    return at === -1 ? themes.length : at;
  };
  const groups = new Map<
    string,
    { scope: Scope; theme: string; declarations: Map<string, string> }
  >();
  for (const entry of entries.values()) {
    const key = `${entry.theme}|${keyOf(entry.scope)}`;
    const group = groups.get(key) ?? {
      declarations: new Map<string, string>(),
      scope: entry.scope,
      theme: entry.theme,
    };
    group.declarations.set(entry.variable, entry.value);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      rank(a.theme) - rank(b.theme) ||
      compare(a.theme, b.theme) ||
      compare(keyOf(a.scope), keyOf(b.scope))
  );
  return ordered.length === 0
    ? ""
    : `${ordered.map((g) => render(g.scope, g.declarations)).join("\n\n")}\n`;
};
