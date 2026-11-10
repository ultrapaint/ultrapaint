/**
 * Tailwind v4's utilities, as the adapter's class writer and every reader of classes speak them
 * (ADR 0024): how a class is written (its variants, `!`, sign, utility and value, a colour's
 * opacity, an arbitrary value with its type), the steps of Tailwind's default scales, and the
 * keywords a utility takes for a length or a colour, both ways (`w-full` is `100%`, `100%` is
 * `w-full`). What a class means to a reader (a look's field, DESIGN.md's token, the inventory's
 * kind) is the reader's. Pure.
 */
import type { DETAILED_GROUPS } from "@ultrapaint/contracts/token-presets";
import { tokenPrefix } from "@ultrapaint/contracts/token-table";

/** A class taken apart: `md:hover:!-mt-[13px]` is `md`, `hover`, `!` before, minus, `mt-[13px]`. */
export interface TailwindClass {
  /** `!` written before the utility (Tailwind v3's way), or after it (v4's). */
  readonly important: "" | "before" | "after";
  readonly negative: boolean;
  /** The utility and its value, without the sign or the `!`: `mt-[13px]`, `bg-primary/90`. */
  readonly utility: string;
  /** Outermost first, without their colons. */
  readonly variants: readonly string[];
}

/** Each place `separator` stands outside brackets and parentheses. */
const outside = (text: string, separator: string): number[] => {
  const at: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === separator && depth === 0) {
      at.push(i);
    }
  }
  return at;
};

export const parseClass = (cls: string): TailwindClass => {
  const variants: string[] = [];
  let from = 0;
  for (const at of outside(cls, ":")) {
    variants.push(cls.slice(from, at));
    from = at + 1;
  }
  let utility = cls.slice(from);
  let important: TailwindClass["important"] = "";
  if (utility.startsWith("!")) {
    utility = utility.slice(1);
    important = "before";
  }
  if (utility.endsWith("!")) {
    utility = utility.slice(0, -1);
    important = "after";
  }
  const negative = utility.startsWith("-");
  return {
    important,
    negative,
    utility: negative ? utility.slice(1) : utility,
    variants,
  };
};

/** A class put back together, `parseClass`'s other way. */
export const printClass = ({
  important = "",
  negative = false,
  utility,
  variants = [],
}: Partial<TailwindClass> & { readonly utility: string }): string => {
  const bang = (where: TailwindClass["important"]) =>
    important === where ? "!" : "";
  return `${variants.map((v) => `${v}:`).join("")}${bang("before")}${negative ? "-" : ""}${utility}${bang("after")}`;
};

/** A utility as one of the names a reader knows and its value; no value when it is bare. */
export interface Utility {
  readonly use: string;
  readonly value: string | undefined;
}

/**
 * The reading of a utility against the names a reader knows, longest first so `gap-x-2` is
 * `gap-x` and `rounded-t-md` `rounded-t` when both are known; null for a utility of none.
 */
export const utilityReader = (names: Iterable<string>) => {
  const longestFirst = [...new Set(names)].sort((a, b) => b.length - a.length);
  return (utility: string): Utility | null => {
    for (const use of longestFirst) {
      if (utility === use) {
        return { use, value: undefined };
      }
      if (utility.startsWith(`${use}-`)) {
        return { use, value: utility.slice(use.length + 1) };
      }
    }
    return null;
  };
};

/** A value and its opacity modifier, `blue-500/50` → `blue-500` and `/50`; `/` in brackets stays. */
export const splitModifier = (
  value: string
): { readonly modifier: string; readonly value: string } => {
  const [at] = outside(value, "/");
  return at === undefined
    ? { modifier: "", value }
    : { modifier: value.slice(at), value: value.slice(0, at) };
};

/** The data type an arbitrary value is marked with: `[color:var(--x)]`, `(length:--x)`. */
const HINT_RE = /^([a-z-]+):(.+)$/s;
const UNDERSCORES_RE = /_/g;

/** An arbitrary value as CSS, with the type it is marked with. */
export interface Arbitrary {
  readonly css: string;
  readonly hint?: string;
}

/**
 * The CSS of an arbitrary value, `[…]` or a variable, `(--x)`, with its type hint; none for a
 * step of a scale or a keyword. Tailwind writes a space as `_`, except inside a URL.
 */
export const arbitraryOf = (value: string): Arbitrary | undefined => {
  const bracket = value.startsWith("[") && value.endsWith("]");
  const variable = value.startsWith("(") && value.endsWith(")");
  if (!(bracket || variable) || value.length < 3) {
    return;
  }
  const inner = value.slice(1, -1);
  const hinted: RegExpExecArray | null = HINT_RE.exec(inner);
  const [hint, raw] =
    hinted?.[1] === undefined || hinted[2] === undefined
      ? [undefined, inner]
      : [hinted[1], hinted[2]];
  const spaced = raw.includes("url(") ? raw : raw.replace(UNDERSCORES_RE, " ");
  const css = variable ? `var(${spaced.trim()})` : spaced.trim();
  return hint === undefined ? { css } : { css, hint };
};

const WHITESPACE_RE = /\s+/g;

/**
 * CSS as an arbitrary value, `arbitraryOf`'s other way: `[length:1.5rem]`, a space as `_`. With
 * a property's name for the type, it is an arbitrary property, `[mask-size:100%_100%]`.
 */
export const printArbitrary = (css: string, hint?: string): string => {
  const value = css.trim().replace(WHITESPACE_RE, "_");
  return hint === undefined ? `[${value}]` : `[${hint}:${value}]`;
};

// ---- Tailwind v4's default theme ----

/** The steps of `--text-*`, `text-xs` to `text-9xl`. */
export const TEXT_STEPS: ReadonlySet<string> = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);

/** The steps of `--font-weight-*`, with the weight each is. */
export const WEIGHT_STEPS: ReadonlyMap<string, number> = new Map([
  ["thin", 100],
  ["extralight", 200],
  ["light", 300],
  ["normal", 400],
  ["medium", 500],
  ["semibold", 600],
  ["bold", 700],
  ["extrabold", 800],
  ["black", 900],
]);

/** The step of `--font-weight-*` a weight is, `600` → `semibold`. */
export const weightStepOf = (weight: number): string | undefined =>
  [...WEIGHT_STEPS].find(([, n]) => n === weight)?.[0];

/** The steps of `--radius-*`, `rounded-xs` to `rounded-4xl`. */
export const RADIUS_STEPS: ReadonlySet<string> = new Set([
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
]);

/** The steps of `--shadow-*`, `shadow-2xs` to `shadow-2xl`. */
export const SHADOW_STEPS: ReadonlySet<string> = new Set([
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
]);

// ---- Keywords ----

/** Keywords a utility takes, by the CSS each is. */
interface Keywords {
  /** The keyword a value is written as, `100%` → `full`, any case. */
  readonly keyword: (css: string) => string | undefined;
}

/** Each keyword with the CSS it is, in every spelling a value may have. */
const keywords = (
  table: Readonly<Record<string, string | readonly string[]>>
): Keywords => {
  const byCss = new Map(
    Object.entries(table).flatMap(([keyword, css]) =>
      (typeof css === "string" ? [css] : css).map(
        (c) => [c.toLowerCase(), keyword] as const
      )
    )
  );
  return { keyword: (css) => byCss.get(css.trim().toLowerCase()) };
};

/** The sizes a length utility says by name, `w-full`, `h-fit`; a maximum's without `auto`. */
const FITS = {
  fit: "fit-content",
  full: "100%",
  max: "max-content",
  min: "min-content",
};
const SIZES = { auto: "auto", ...FITS };

/** The viewport's lengths, which a width and a height each take in either axis's unit. */
const VIEWPORT = {
  dvh: "100dvh",
  dvw: "100dvw",
  lvh: "100lvh",
  lvw: "100lvw",
  svh: "100svh",
  svw: "100svw",
};

const NO_KEYWORDS = keywords({});
const WIDTH = { ...SIZES, ...VIEWPORT, screen: "100vw" };
const HEIGHT = { ...SIZES, ...VIEWPORT, lh: "1lh", screen: "100vh" };
const MARGIN = keywords({ auto: "auto" });

/**
 * The keywords each length utility takes, as Tailwind v4 compiles them: a width or a height
 * (and its minimum) a size by name and the viewport's lengths, `screen` in its own axis's unit
 * and a height the line's (`lh`); a maximum no `auto` but `none`; `size` no `screen`; a margin
 * `auto` only. A gap or a padding takes none (`gap-full` is no class). `px` is the spacing
 * scale's, not a keyword.
 */
const LENGTH_KEYWORDS: Readonly<Record<string, Keywords>> = {
  h: keywords(HEIGHT),
  m: MARGIN,
  "max-h": keywords({
    ...FITS,
    ...VIEWPORT,
    lh: "1lh",
    none: "none",
    screen: "100vh",
  }),
  "max-w": keywords({ ...FITS, ...VIEWPORT, none: "none", screen: "100vw" }),
  mb: MARGIN,
  "min-h": keywords(HEIGHT),
  "min-w": keywords(WIDTH),
  ml: MARGIN,
  mr: MARGIN,
  mt: MARGIN,
  mx: MARGIN,
  my: MARGIN,
  size: keywords({ ...SIZES, ...VIEWPORT }),
  w: keywords(WIDTH),
};

/** The keywords a length utility takes, `w` → `full`, `screen`, …; none for `gap` or `p`. */
export const lengthKeywords = (utility: string): Keywords =>
  LENGTH_KEYWORDS[utility] ?? NO_KEYWORDS;

/**
 * The colours a colour utility names without a token: `black` and `white`, Tailwind's theme's
 * (read as its `#000` and `#fff`, written from those or the CSS names), and CSS's own keywords.
 */
export const COLOR_KEYWORDS = keywords({
  black: ["#000", "black"],
  current: "currentColor",
  inherit: "inherit",
  transparent: "transparent",
  white: ["#fff", "white"],
});

// ---- Colour namespaces ----

/**
 * The utilities that read each per-property namespace of the token table's colours (ADR 0062)
 * before `--color-*`, as Tailwind v4 compiles them: `bg-danger-subtle` is
 * `--background-color-danger-subtle`. Keyed by the table's namespaces, so one it adds does not
 * compile here until its utilities are said.
 */
const OWN_COLORS: Readonly<
  Record<(typeof DETAILED_GROUPS)[number]["prefix"], readonly string[]>
> = {
  "background-color-": ["bg", "from", "via", "to"],
  "border-color-": [
    "border",
    "border-x",
    "border-y",
    "border-t",
    "border-r",
    "border-b",
    "border-l",
    "border-s",
    "border-e",
    "divide",
  ],
  "text-color-": ["text"],
};

/**
 * The namespaces a colour utility reads its tokens from, as token names start: its own first
 * (`bg` reads `background-color-`), then `color-`, which every colour utility reads.
 */
export const colorNamespaces = (utility: string): string[] => [
  ...Object.entries(OWN_COLORS).flatMap(([prefix, utilities]) =>
    utilities.includes(utility) ? [prefix] : []
  ),
  tokenPrefix("color"),
];

/**
 * A colour token as the value a utility names it by, `bg` and `background-color-danger-subtle` →
 * `danger-subtle`; null for a token of a namespace the utility does not read.
 */
export const colorValueOf = (utility: string, token: string): string | null => {
  const prefix = colorNamespaces(utility).find((p) => token.startsWith(p));
  return prefix === undefined ? null : token.slice(prefix.length);
};
