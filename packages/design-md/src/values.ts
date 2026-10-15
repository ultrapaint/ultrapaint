/**
 * CSS values as the format holds them. A colour is any CSS colour; a dimension is a number in
 * `px`, `em` or `rem`. The code writes values the format cannot hold (`var(--radius)`,
 * `calc(var(--radius) - 2px)`), so they are resolved first: variables from the code's tokens,
 * arithmetic on lengths worked out.
 */

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION_RE =
  /^(?:rgba?|hsla?|hwb|oklch|oklab|lch|lab|color-mix|color)\(.*\)$/is;
const NAMED_RE = /^[a-z]+$/i;
const NOT_COLORS = new Set([
  "currentcolor",
  "inherit",
  "initial",
  "none",
  "revert",
  "unset",
]);
const DIMENSION_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem)$/;
const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** A colour the format holds: hex, a name, or a colour function with nothing left to resolve. */
export const isColor = (value: string): boolean => {
  const v = value.trim();
  if (HEX_RE.test(v)) {
    return true;
  }
  if (COLOR_FUNCTION_RE.test(v)) {
    return !v.includes("var(");
  }
  return NAMED_RE.test(v) && !NOT_COLORS.has(v.toLowerCase());
};

/** A number in `px`, `em` or `rem`. */
export const isDimension = (value: string): boolean =>
  DIMENSION_RE.test(value.trim());

/** A unitless number, as a string the code wrote. */
export const isPlainNumber = (value: string): boolean =>
  NUMBER_RE.test(value.trim());

/** A number written without float noise: 1.1111 rather than 1.1111111111. */
export const formatNumber = (n: number): string => String(Number(n.toFixed(4)));

/** The index of the parenthesis that closes the one at `open`, or -1. */
const closing = (text: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
};

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

const MAX_DEPTH = 10;
const DASHES_RE = /^--/;

/**
 * `var(--name)` replaced by the token's value, recursively, its fallback when the token is
 * unknown; null when a variable resolves to nothing.
 */
const substitute = (
  value: string,
  lookup: (name: string) => string | undefined,
  depth: number
): string | null => {
  if (depth > MAX_DEPTH) {
    return null;
  }
  const at = value.indexOf("var(");
  if (at < 0) {
    return value;
  }
  const open = at + "var".length;
  const end = closing(value, open);
  if (end < 0) {
    return null;
  }
  const inner = value.slice(open + 1, end);
  const comma = topLevelComma(inner);
  const name = (comma < 0 ? inner : inner.slice(0, comma))
    .trim()
    .replace(DASHES_RE, "");
  const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
  const found = lookup(name) ?? fallback;
  if (found === undefined) {
    return null;
  }
  const replaced = substitute(found, lookup, depth + 1);
  if (replaced === null) {
    return null;
  }
  return substitute(
    `${value.slice(0, at)}${replaced}${value.slice(end + 1)}`,
    lookup,
    depth + 1
  );
};

type Unit = "" | "em" | "px" | "rem";
interface Quantity {
  readonly n: number;
  readonly unit: Unit;
}

const ROOT_PX = 16;
const TOKEN_RE = /\s*(-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)?|infinity|[-+*/()])/iy;
const QUANTITY_RE = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)?$/i;

const tokenise = (text: string): string[] | null => {
  const tokens: string[] = [];
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < text.length) {
    const start = TOKEN_RE.lastIndex;
    // Typed by hand: the linter otherwise takes the result for non-null.
    const match: RegExpExecArray | null = TOKEN_RE.exec(text);
    const token = match === null ? undefined : match[1];
    if (token === undefined) {
      return text.slice(start).trim() === "" ? tokens : null;
    }
    tokens.push(token.toLowerCase());
  }
  return tokens;
};

/** Two lengths in one unit: `rem` and `px` meet in pixels; `em` meets only `em`. */
const together = (a: Quantity, b: Quantity): [Quantity, Quantity] | null => {
  if (a.unit === b.unit) {
    return [a, b];
  }
  const px = (q: Quantity): Quantity | null => {
    if (q.unit === "px") {
      return q;
    }
    return q.unit === "rem" ? { n: q.n * ROOT_PX, unit: "px" } : null;
  };
  const pa = px(a);
  const pb = px(b);
  return pa && pb ? [pa, pb] : null;
};

/** One number of a `calc()`: a length, a plain number, or infinity. */
const quantityOf = (token: string): Quantity | null => {
  if (token === "infinity") {
    return { n: Number.POSITIVE_INFINITY, unit: "" };
  }
  const match: RegExpExecArray | null = QUANTITY_RE.exec(token);
  if (match === null) {
    return null;
  }
  const [, n = "", unit = ""] = match;
  return { n: Number(n), unit: unit.toLowerCase() as Unit };
};

/** `a op b`, when the units allow it: a length times a number, a length over one, two lengths summed. */
const combine = (a: Quantity, op: string, b: Quantity): Quantity | null => {
  if (op === "*") {
    return a.unit !== "" && b.unit !== ""
      ? null
      : { n: a.n * b.n, unit: a.unit || b.unit };
  }
  if (op === "/" && b.unit === "") {
    return { n: a.n / b.n, unit: a.unit };
  }
  const both = together(a, b);
  if (!both) {
    return null;
  }
  const [x, y] = both;
  if (op === "/") {
    return { n: x.n / y.n, unit: "" };
  }
  return { n: op === "+" ? x.n + y.n : x.n - y.n, unit: x.unit };
};

/** `calc()`'s arithmetic on lengths and numbers: `+ - * /` and parentheses. */
const evaluate = (tokens: readonly string[]): Quantity | null => {
  let i = 0;
  const next = () => {
    const token = tokens[i];
    i += 1;
    return token;
  };
  const primary = (): Quantity | null => {
    const token = next();
    if (token === "(") {
      const inner = sum();
      return next() === ")" ? inner : null;
    }
    if (token === "-") {
      const inner = primary();
      return inner && { n: -inner.n, unit: inner.unit };
    }
    return token === undefined ? null : quantityOf(token);
  };
  const chain = (
    operand: () => Quantity | null,
    ops: readonly string[]
  ): Quantity | null => {
    let left = operand();
    while (left && ops.includes(tokens[i] ?? "")) {
      const op = next() ?? "";
      const right = operand();
      left = right && combine(left, op, right);
    }
    return left;
  };
  const product = () => chain(primary, ["*", "/"]);
  const sum = (): Quantity | null => chain(product, ["+", "-"]);
  const result = sum();
  return i === tokens.length ? result : null;
};

/** What a radius the code makes infinite (`calc(infinity * 1px)`) is written as. */
const INFINITE_PX = "9999px";

const calculate = (value: string): string | null => {
  const v = value.trim();
  if (!(v.startsWith("calc(") && closing(v, 4) === v.length - 1)) {
    return v;
  }
  const tokens = tokenise(v.slice(5, -1));
  const result = tokens && evaluate(tokens);
  if (!result) {
    return null;
  }
  if (!Number.isFinite(result.n)) {
    return result.unit === "px" ? INFINITE_PX : null;
  }
  return `${formatNumber(result.n)}${result.unit}`;
};

/**
 * A value of the code as plain CSS: variables replaced by the tokens' values, a `calc()` of
 * lengths worked out. Null when something cannot be resolved.
 */
export const resolveCss = (
  value: string,
  lookup: (name: string) => string | undefined
): string | null => {
  const substituted = substitute(value.trim(), lookup, 0);
  return substituted === null ? null : calculate(substituted);
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
