/**
 * CSS values as the format holds them. A colour is any CSS colour, as contracts' `isColor` reads
 * one; a dimension is a number in `px`, `em` or `rem`. The code writes values the format cannot
 * hold (`var(--radius)`, `calc(var(--radius) - 2px)`), so they are resolved first, by contracts'
 * `resolveCss`: variables from the code's tokens, arithmetic on lengths worked out.
 */
import { parseLength, parseNumber } from "@ultrapaint/contracts/token-value";

const FORMAT_UNITS: ReadonlySet<string> = new Set(["em", "px", "rem"]);

/** A number in `px`, `em` or `rem`. */
export const isDimension = (value: string): boolean =>
  FORMAT_UNITS.has(parseLength(value)?.unit ?? "");

/** A unitless number, as a string the code wrote. */
export const isPlainNumber = (value: string): boolean =>
  parseNumber(value) !== null;

/** The first comma of `text` that is not inside parentheses, or -1. */
const topLevelComma = (text: string): number => {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      return i;
    }
  }
  return -1;
};

const QUOTED_RE = /^(["'])(.*)\1$/;

const GENERIC_FAMILIES = new Set([
  "-apple-system",
  "blinkmacsystemfont",
  "cursive",
  "emoji",
  "fangsong",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

/** The family a font stack is set in: its first named family, the first one when all are generic. */
export const familyOf = (stack: string): string | null => {
  const families: string[] = [];
  let rest = stack;
  for (;;) {
    const comma = topLevelComma(rest);
    families.push(comma < 0 ? rest : rest.slice(0, comma));
    if (comma < 0) {
      break;
    }
    rest = rest.slice(comma + 1);
  }
  const names = families
    .map((f) => f.trim().replace(QUOTED_RE, "$2"))
    .filter((f) => f !== "");
  return (
    names.find((f) => !GENERIC_FAMILIES.has(f.toLowerCase())) ??
    names[0] ??
    null
  );
};
