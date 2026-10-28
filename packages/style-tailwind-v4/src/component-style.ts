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

const CLASS_RE = /^(bg|text|rounded|p|px|py|h|w|size)(?:-(.+))?$/;
const ARBITRARY_RE = /^\[(.+)\]$/;
const LENGTH_RE = /^(-?\d*\.?\d+)(px|rem|em)$/;
const SPACES_RE = /\s+/;
const IMPORTANT_RE = /^!|!$/g;

/** The groups of `re` in `text`, or none. */
export const groups = (
  re: RegExp,
  text: string
): readonly (string | undefined)[] => {
  // Typed by hand: the linter otherwise takes the result for non-null.
  const match: RegExpExecArray | null = re.exec(text);
  return match === null ? [] : match.slice(1);
};

/** What is inside `[…]`, for an arbitrary value. */
export const arbitraryOf = (value: string) => groups(ARBITRARY_RE, value)[0];

export interface Reading {
  /** The spacing base the code declares, when it reads lengths off the scale. */
  readonly base?: string | undefined;
  readonly names: ReadonlySet<string>;
}

const colourOf = (value: string, { names }: Reading) => {
  const arbitrary = arbitraryOf(value);
  if (arbitrary !== undefined) {
    return arbitrary;
  }
  return names.has(`color-${value}`) ? `$color-${value}` : null;
};

const lengthOf = (value: string, { base, names }: Reading) => {
  const arbitrary = arbitraryOf(value);
  if (arbitrary !== undefined) {
    return LENGTH_RE.test(arbitrary) ? arbitrary : null;
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
  const arbitrary = arbitraryOf(value);
  return arbitrary !== undefined && LENGTH_RE.test(arbitrary)
    ? arbitrary
    : null;
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

export const componentStyle = (
  classes: string,
  tokens: readonly SourceToken[]
): ComponentStyle => {
  const reading: Reading = {
    base: tokens.find((t) => t.name === SPACING_BASE)?.value,
    names: new Set(tokens.map((t) => t.name)),
  };
  const found = new Map<string, string>();
  for (const raw of classes.split(SPACES_RE)) {
    const cls = raw.replace(IMPORTANT_RE, "");
    if (cls === "" || cls.includes(":") || cls.includes("/")) {
      continue;
    }
    const [use, value] = groups(CLASS_RE, cls);
    const read = use === undefined ? null : READERS[use]?.(value, reading);
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
