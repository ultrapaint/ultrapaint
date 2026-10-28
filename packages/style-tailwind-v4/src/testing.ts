/**
 * Tailwind v4 itself, for the adapter's tests to check a class against: its default theme as its
 * stylesheet declares it, and what each class sets as the installed `tailwindcss` compiles it.
 *
 * For tests only: imported as `@ultrapaint/style-tailwind-v4/testing`, never by the adapter.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";

const RULE_RE = /\.((?:\\.|[^\s{,])+)\s*\{([^{}]*)\}/g;
const DECLARATION_RE = /([\w-]+)\s*:\s*([^;]+);/g;
const ESCAPE_RE = /\\(.)/g;

/** Tailwind's default theme, `tailwindcss/theme.css`. */
export const tailwindTheme = (): string =>
  readFileSync(
    createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
    "utf8"
  );

/** What each rule of compiled CSS sets, by its class: `gap-[100%]` → `gap: 100%`. */
export const rulesOf = (
  css: string
): Map<string, ReadonlyMap<string, string>> => {
  const rules = new Map<string, ReadonlyMap<string, string>>();
  for (const [, selector = "", body = ""] of css.matchAll(RULE_RE)) {
    rules.set(
      selector.replace(ESCAPE_RE, "$1"),
      new Map(
        Array.from(body.matchAll(DECLARATION_RE), ([, p = "", v = ""]) => [
          p,
          v.trim(),
        ])
      )
    );
  }
  return rules;
};

/** What each class sets as Tailwind compiles it with its default theme; none for no class. */
export const compiledClasses = async (classes: Iterable<string>) => {
  const compiler = await compile(
    `${tailwindTheme()}\n@tailwind utilities;`,
    {}
  );
  return rulesOf(compiler.build([...classes]));
};
