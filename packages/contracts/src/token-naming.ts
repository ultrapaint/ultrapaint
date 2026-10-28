/**
 * A token from another tool, named and placed once: what kind of token a path another tool writes
 * (a Figma variable's `Color/Text/Primary`, a Design Tokens file's `font.size.sm`) names, and the
 * design's name for it, from the path and a hint of what the value is. The tools' readers keep
 * their syntax and give this module the path and the hint; the token table's prefixes make the
 * name.
 *
 * The hint decides wherever it says what the value is (a colour, a shadow, a font family or
 * weight, a duration, a cubic Bézier); the path's words decide only for a dimension, a number or
 * a text, and for a value of no type. A name drops only the found kind's own words
 * (`Color/Text/Primary` is `color-text-primary`, `Rounded/lg` is `radius-lg`), and the words that
 * say where a token sits in the other tool rather than what it is (`Primitives`, `Semantic`).
 * Gap, padding and margin name spacing and stay in the name (`spacing-gap-md`). Pure.
 */
import { SPACING_BASE, tokenKindOf, tokenPrefix } from "./token-table.ts";
import type { TokenKind } from "./tokens.ts";

/** A kind the design system lists: every kind but `other`. */
export type ListedKind = Exclude<TokenKind, "other">;

/**
 * What another tool says a value is: the Design Tokens format's types that name one, a number or
 * a text (Figma's variables), or null when nothing says.
 */
export type ValueHint =
  | "color"
  | "cubicBezier"
  | "dimension"
  | "duration"
  | "fontFamily"
  | "fontWeight"
  | "number"
  | "shadow"
  | "string"
  | null;

/** A token another tool names: its kind and the design's name, or why it is left out. */
export type ForeignToken =
  | { readonly kind: ListedKind; readonly name: string }
  | { readonly skipped: string };

interface KindWords {
  /** Words that say a token is of the kind and stay in its name: `gap`. */
  readonly kept?: readonly string[];
  /** Words that say a token is of the kind, dropped from its name: `corner`, `font size`. */
  readonly own: readonly string[];
  /** Words dropped from its name that say nothing of the kind alone: `typography`. */
  readonly quiet?: readonly string[];
}

const TEXT_QUIET = ["typography", "type", "font", "text"];

/**
 * The words each kind goes by in other tools, as lowercase words (a camel-cased `fontSize` reads
 * `font size`). Every kind the design system lists has its entry: a new kind fails to compile
 * until it says its words.
 */
const KIND_WORDS: Record<ListedKind, KindWords> = {
  animation: { own: ["animation", "animations", "animate"] },
  borderWidth: {
    own: ["border width", "border widths", "stroke width", "stroke", "strokes"],
  },
  breakpoint: { own: ["breakpoint", "breakpoints", "screen", "screens"] },
  color: { own: ["color", "colors", "colour", "colours"] },
  container: { own: ["container", "containers"] },
  duration: { own: ["duration", "durations"] },
  easing: { own: ["easing", "easings", "ease", "eases"] },
  font: {
    own: [
      "font family",
      "font families",
      "family",
      "families",
      "font",
      "fonts",
      "typeface",
      "typefaces",
    ],
    quiet: ["typography", "type"],
  },
  fontSize: {
    own: [
      "font size",
      "font sizes",
      "text size",
      "text sizes",
      "size text",
      "type scale",
      "text",
    ],
    quiet: [...TEXT_QUIET, "size", "sizes"],
  },
  fontWeight: {
    own: ["font weight", "font weights", "weight", "weights"],
    quiet: TEXT_QUIET,
  },
  leading: {
    own: ["line height", "line heights", "leading"],
    quiet: TEXT_QUIET,
  },
  radius: {
    own: [
      "border radius",
      "border radii",
      "corner radius",
      "radius",
      "radii",
      "corner",
      "corners",
      "rounded",
    ],
  },
  shadow: {
    own: [
      "box shadow",
      "box shadows",
      "shadow",
      "shadows",
      "effect",
      "effects",
    ],
  },
  spacing: {
    kept: ["gap", "padding", "margin", "inset"],
    own: ["spacing", "spacings", "space", "spaces"],
  },
  tracking: {
    own: ["letter spacing", "letter spacings", "tracking"],
    quiet: TEXT_QUIET,
  },
};

/** Words that say where a token sits in the other tool, not what it is: dropped from every name. */
const PLACE_WORDS = new Set([
  "primitives",
  "primitive",
  "semantic",
  "tokens",
  "token",
  "theme",
  "global",
]);

/** The kind a hint says the value is, where it says one. */
const HINT_KINDS: Partial<Record<NonNullable<ValueHint>, ListedKind>> = {
  color: "color",
  cubicBezier: "easing",
  duration: "duration",
  fontFamily: "font",
  fontWeight: "fontWeight",
  shadow: "shadow",
};

/** The kinds held in a length, which a number is read as pixels of. */
const LENGTH_KINDS: readonly ListedKind[] = [
  "spacing",
  "fontSize",
  "tracking",
  "radius",
  "borderWidth",
  "breakpoint",
  "container",
];

/** The kinds a path's words choose among, for a hint that does not say the kind. */
const PATH_KINDS: Record<
  "dimension" | "number" | "string",
  readonly ListedKind[]
> = {
  dimension: [...LENGTH_KINDS, "leading"],
  number: [...LENGTH_KINDS, "leading", "fontWeight"],
  string: ["font"],
};

/** Why a path's words found no kind, by the hint. */
const NO_KIND: Record<"dimension" | "number" | "string" | "none", string> = {
  dimension: "a dimension, and no word of the path says what it measures",
  none: "no type, and no word of the path says what kind of token it is",
  number: "a number, and no word of the path names a scale it is on",
  string: "a text, and no word of the path says it is a font",
};

const CAMEL_RE = /([a-z])([A-Z])/g;
const NOT_WORD_RE = /[^a-z0-9]+/;
const NUMBER_RE = /^\d+$/;

/** A path's words: each segment's, lowercase, a camel-cased segment split where it changes case. */
const wordsOf = (path: readonly string[]): string[] =>
  path.flatMap((segment) =>
    segment
      .replace(CAMEL_RE, "$1 $2")
      .toLowerCase()
      .split(NOT_WORD_RE)
      .filter((w) => w !== "")
  );

const phrase = (p: string) => p.split(" ");

/** Where a phrase starts in the words, every time. */
const positions = (words: readonly string[], p: readonly string[]) =>
  words.flatMap((_, i) => (p.every((w, j) => words[i + j] === w) ? [i] : []));

/**
 * The kind among `kinds` the path's words name: the longest phrase found (`letter spacing` over
 * `spacing`), then the earliest, then the table's order.
 */
const kindByWords = (
  words: readonly string[],
  kinds: readonly ListedKind[]
): ListedKind | null => {
  let best: { kind: ListedKind; at: number; length: number } | null = null;
  for (const kind of kinds) {
    const { kept = [], own } = KIND_WORDS[kind];
    for (const p of [...own, ...kept].map(phrase)) {
      for (const at of positions(words, p)) {
        if (
          !best ||
          p.length > best.length ||
          (p.length === best.length && at < best.at)
        ) {
          best = { at, kind, length: p.length };
        }
      }
    }
  }
  return best?.kind ?? null;
};

/** The words left once a kind's own and quiet words and the place words are taken out. */
const nameWords = (words: readonly string[], kind: ListedKind): string[] => {
  const { own, quiet = [] } = KIND_WORDS[kind];
  // The longest first: `font size` goes whole before `text` is looked for.
  const phrases = own.map(phrase).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const found = phrases.find((p) => p.every((w, j) => words[i + j] === w));
    out.push(...(found ? [] : words.slice(i, i + 1)));
    i += found?.length ?? 1;
  }
  const dropped = new Set([...quiet, ...PLACE_WORDS]);
  return (
    out
      .filter((w) => !dropped.has(w))
      // `Danger/Danger` is one danger; `Grid/2/2` keeps its numbers.
      .filter((w, i, all) => w !== all[i - 1] || NUMBER_RE.test(w))
  );
};

/**
 * What kind of token another tool's path names and the design's name for it, from the path's
 * segments (`["Color", "Text", "Primary"]`) and a hint of what the value is; or why it is left
 * out. The spacing kind with nothing left to name it by is the spacing base, `spacing`.
 */
export const foreignToken = (
  path: readonly string[],
  hint: ValueHint
): ForeignToken => {
  const words = wordsOf(path);
  const decided = hint === null ? undefined : HINT_KINDS[hint];
  const kind =
    decided ??
    kindByWords(
      words,
      hint === null
        ? (Object.keys(KIND_WORDS) as ListedKind[])
        : PATH_KINDS[hint as keyof typeof PATH_KINDS]
    );
  if (kind === null) {
    return {
      skipped:
        NO_KIND[hint === null ? "none" : (hint as keyof typeof PATH_KINDS)],
    };
  }
  const rest = nameWords(words, kind);
  if (rest.length === 0) {
    return kind === "spacing"
      ? { kind, name: SPACING_BASE }
      : {
          skipped: "the path names only the kind, nothing to call the token by",
        };
  }
  const name = `${tokenPrefix(kind)}${rest.join("-")}`;
  return tokenKindOf(name) === kind
    ? { kind, name }
    : { skipped: `named ${name}, it would read as another kind of token` };
};

/** A number as CSS for a kind: pixels for a length (a radius, a spacing), as it is otherwise. */
export const numberCss = (kind: TokenKind, value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return (LENGTH_KINDS as readonly TokenKind[]).includes(kind)
    ? `${rounded}px`
    : String(rounded);
};
