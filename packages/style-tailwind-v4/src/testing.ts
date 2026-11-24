/**
 * Tailwind v4 itself, for the adapter's tests to check a class against: its default theme as its
 * stylesheet declares it, and what each class sets as the installed `tailwindcss` compiles it.
 *
 * For tests only: imported as `@ultrapaint/style-tailwind-v4/testing`, never by the adapter.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";

const RULE_RE = /\.((?:\\.|[^\s{,])+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
/** A block inside a rule, `@supports (…) { … }`, whose declarations win where it applies. */
const NESTED_RE = /@[^{}]*\{([^{}]*)\}/g;
const DECLARATION_RE = /([\w-]+)\s*:\s*([^;]+);/g;
const ESCAPE_RE = /\\(.)/g;

/** Tailwind's default theme, `tailwindcss/theme.css`. */
export const tailwindTheme = (): string =>
  readFileSync(
    createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
    "utf8"
  );

/**
 * What each rule of compiled CSS sets, by its class: `gap-[100%]` → `gap: 100%`. A declaration
 * of a block inside the rule (`@supports`) wins over the rule's own, as it does in a browser
 * that supports it: `bg-linear-45` mixes in oklab.
 */
export const rulesOf = (
  css: string
): Map<string, ReadonlyMap<string, string>> => {
  const rules = new Map<string, ReadonlyMap<string, string>>();
  const declarations = (body: string) =>
    Array.from(
      body.matchAll(DECLARATION_RE),
      ([, p = "", v = ""]) => [p, v.trim()] as const
    );
  for (const [, selector = "", body = ""] of css.matchAll(RULE_RE)) {
    const nested = Array.from(body.matchAll(NESTED_RE), (m) => m[1] ?? "");
    rules.set(
      selector.replace(ESCAPE_RE, "$1"),
      new Map([
        ...declarations(body.replace(NESTED_RE, "")),
        ...nested.flatMap(declarations),
      ])
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
