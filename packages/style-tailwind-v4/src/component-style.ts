/**
 * A component's Tailwind classes read as DESIGN.md's component tokens (ADR 0027): `bg-primary` is
 * its background, `text-primary-foreground` its text colour, `rounded-md` its radius, `h-9` and
 * `px-4` its height and padding. Only the state it starts in: a class behind a variant
 * (`hover:`, `dark:`, `md:`) is another state, and a colour with an opacity (`bg-primary/90`) is
 * not one the format can hold.
 */
import {
  SPACING_BASE,
  spacingLength,
  spacingStepOf,
} from "@ultrapaint/contracts/token-table";
import type {
  ComponentStyle,
  SourceToken,
} from "@ultrapaint/contracts/tokens";
import {
  arbitraryOf,
  parseClass,
  splitModifier,
  utilityReader,
} from "./utilities.ts";

const LENGTH_RE = /^(-?\d*\.?\d+)(px|rem|em)$/;
const SPACES_RE = /\s+/;

/** The groups of `re` in `text`, or none. */
export const groups = (
  re: RegExp,
  text: string
): readonly (string | undefined)[] => {
  // Typed by hand: the linter otherwise takes the result for non-null.
  const match: RegExpExecArray | null = re.exec(text);
  return match === null ? [] : match.slice(1);
};

export interface Reading {
  /** The spacing base the code declares, when it reads lengths off the scale. */
  readonly base?: string | undefined;
  readonly names: ReadonlySet<string>;
}

/** An arbitrary value's CSS when it is of `type` or not marked; null when it is of another. */
const arbitraryAs = (value: string, type: string) => {
  const arbitrary = arbitraryOf(value);
  if (arbitrary === undefined) {
    return;
  }
  return arbitrary.hint === undefined || arbitrary.hint === type
    ? arbitrary.css
    : null;
};

/** An arbitrary length, `[6px]`; null for anything else in brackets. */
const arbitraryLength = (value: string) => {
  const css = arbitraryAs(value, "length");
  return css === undefined || css === null || LENGTH_RE.test(css) ? css : null;
};

const colourOf = (value: string, { names }: Reading) => {
  const arbitrary = arbitraryAs(value, "color");
  if (arbitrary !== undefined) {
    return arbitrary;
  }
  return names.has(`color-${value}`) ? `$color-${value}` : null;
};

const lengthOf = (value: string, { base, names }: Reading) => {
  const arbitrary = arbitraryLength(value);
  if (arbitrary !== undefined) {
    return arbitrary;
  }
  if (value === "px") {
    return "1px";
  }
  const name = `spacing-${value}`;
  if (names.has(name)) {
    return `$${name}`;
  }
  const step = spacingStepOf(name);
  return step === null ? null : spacingLength(base, step);
};

export const radiusOf = (value: string | undefined, { names }: Reading) => {
  if (value === undefined) {
    return names.has("radius") ? "$radius" : null;
  }
  if (value === "none") {
    return "0px";
  }
  if (names.has(`radius-${value}`)) {
    return `$radius-${value}`;
  }
  if (value === "full") {
    return "9999px";
  }
  return arbitraryLength(value) ?? null;
};

/** Each utility read: the property it sets, and its value; null for nothing the format holds. */
const READERS: Readonly<
  Record<
    string,
    (
      value: string | undefined,
      reading: Reading
    ) => readonly [string, string | null] | null
  >
> = {
  bg: (v, r) => (v ? ["backgroundColor", colourOf(v, r)] : null),
  h: (v, r) => (v ? ["height", lengthOf(v, r)] : null),
  p: (v, r) => (v ? ["padding:p", lengthOf(v, r)] : null),
  px: (v, r) => (v ? ["padding:px", lengthOf(v, r)] : null),
  py: (v, r) => (v ? ["padding:py", lengthOf(v, r)] : null),
  rounded: (v, r) => ["rounded", radiusOf(v, r)],
  size: (v, r) => (v ? ["size", lengthOf(v, r)] : null),
  text: (v, r) => (v ? ["textColor", colourOf(v, r)] : null),
  w: (v, r) => (v ? ["width", lengthOf(v, r)] : null),
};

const readUtility = utilityReader(Object.keys(READERS));

export const componentStyle = (
  classes: string,
  tokens: readonly SourceToken[]
): ComponentStyle => {
  const reading: Reading = {
    base: tokens.find((t) => t.name === SPACING_BASE)?.value,
    names: new Set(tokens.map((t) => t.name)),
  };
  const found = new Map<string, string>();
  for (const cls of classes.split(SPACES_RE)) {
    const { negative, utility, variants } = parseClass(cls);
    const parts = readUtility(utility);
    if (
      parts === null ||
      negative ||
      variants.length > 0 ||
      (parts.value !== undefined && splitModifier(parts.value).modifier !== "")
    ) {
      continue;
    }
    const read = READERS[parts.use]?.(parts.value, reading);
    // A later class wins, as it does in the class list.
    if (read && read[1] !== null) {
      found.set(read[0], read[1]);
    }
  }
  // The format has one padding: all sides, else the sides, else the top and bottom.
  const padding =
    found.get("padding:p") ??
    found.get("padding:px") ??
    found.get("padding:py");
  const rest = [...found].filter(([prop]) => !prop.startsWith("padding:"));
  return {
    ...Object.fromEntries(rest),
    ...(padding !== undefined && { padding }),
  } as ComponentStyle;
};
