/**
 * A Tailwind class taken apart the way the usage scan reads it: its variants, importance, sign,
 * utility, value and opacity modifier.
 */
import { COLOR_SET, UTILITIES } from "./usage-vocabulary.ts";

/** How deep in brackets and parentheses each character of a class is. */
const depthChange = (c: string | undefined) => {
  if (c === "[" || c === "(") {
    return 1;
  }
  return c === "]" || c === ")" ? -1 : 0;
};

/** Where `separator` last (or first) stands outside brackets and parentheses; -1 when nowhere. */
const outside = (text: string, separator: string, last: boolean) => {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < text.length; i += 1) {
    depth += depthChange(text[i]);
    if (text[i] === separator && depth === 0) {
      found = i;
      if (!last) {
        return found;
      }
    }
  }
  return found;
};

/** Where the variants of a class end: the last `:` outside brackets and parentheses. */
const baseOf = (candidate: string) =>
  candidate.slice(outside(candidate, ":", true) + 1);

/** `blue-500/50` → `blue-500`: the opacity modifier, outside brackets. */
const withoutModifier = (value: string) => {
  const at = outside(value, "/", false);
  return at === -1 ? value : value.slice(0, at);
};

/** A class taken apart: what is around the utility, the utility, and its value. */
export interface ClassParts {
  /** `!` written before the utility, or after it. */
  readonly important: "" | "before" | "after";
  /** A colour's opacity, `/50`, kept when the value changes. */
  readonly modifier: string;
  readonly negative: boolean;
  readonly use: string;
  readonly value: string;
  /** `hover:md:`, ending in its colon. */
  readonly variants: string;
}

/** A class taken apart; null for anything this does not look at. */
export const splitClass = (candidate: string): ClassParts | null => {
  const variants = candidate.slice(0, outside(candidate, ":", true) + 1);
  let base = baseOf(candidate);
  let important: ClassParts["important"] = "";
  if (base.startsWith("!")) {
    base = base.slice(1);
    important = "before";
  }
  if (base.endsWith("!")) {
    base = base.slice(0, -1);
    important = "after";
  }
  const negative = base.startsWith("-");
  if (negative) {
    base = base.slice(1);
  }
  const parts = { important, negative, variants };
  for (const use of UTILITIES) {
    if (base === use && (use === "rounded" || use === "shadow")) {
      return { ...parts, modifier: "", use, value: "" };
    }
    if (base.startsWith(`${use}-`)) {
      const rest = base.slice(use.length + 1);
      // `/50` is a colour's opacity; on `left-1/2` it is the value.
      const value = COLOR_SET.has(use) ? withoutModifier(rest) : rest;
      return value
        ? { ...parts, modifier: rest.slice(value.length), use, value }
        : null;
    }
  }
  return null;
};

/** A class, read as a utility and its value; null for anything this does not look at. */
export const readClass = (
  candidate: string
): { readonly use: string; readonly value: string } | null => {
  const parts = splitClass(candidate);
  return parts ? { use: parts.use, value: parts.value } : null;
};
