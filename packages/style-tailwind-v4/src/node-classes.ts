/**
 * A node's look as Tailwind v4 utilities (ADR 0024): the classes the inspector's Code tab writes
 * and the rules agents implement a page by (`code-rules.ts`) describe. What a node's fields mean
 * is `@ultrapaint/design-document/css`'s, which gives the node's declarations at each breakpoint
 * with tokens kept by name; this writes each declaration as the utility that sets it, several as
 * the one that sets them all (`flex-1`, `px-2`, `text-lg` with its line height), CSS no utility
 * says as an arbitrary property (`[mask-size:100%_100%]`), and the breakpoints as Tailwind's
 * variants (`md:`, `max-md:`). The JSX around the classes is the design document's own
 * (`@ultrapaint/design-document/code`). Pure.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  ClassWriter,
  Declarations,
  DeclaredValue,
  StyleAt,
} from "@ultrapaint/contracts/node-style";
import {
  lineHeightName,
  spacingBasePx,
  spacingStepAt,
} from "@ultrapaint/contracts/token-table";
import { isToken, tokenName } from "@ultrapaint/design-document/tokens";
import {
  COLOR_KEYWORDS,
  printArbitrary,
  printClass,
  SCREEN_KEYWORDS,
  SIZE_KEYWORDS,
  weightStepOf,
} from "./utilities.ts";

const UPPER_RE = /[A-Z]/g;
const NUMBER_RE = /^-?\d*\.?\d+$/;
const KEYWORD_HEAD_RE = /^(?:flex|space)-/;

/** Values a declaration starts at, which need no class: a reset leaves them so. */
const INITIAL: Record<string, string> = {
  borderColor: "currentColor",
  flexDirection: "row",
  flexGrow: "0",
  flexWrap: "nowrap",
};

/** A utility and the properties it sets, which say what a breakpoint's class takes over from. */
interface Utility {
  readonly cls: string;
  readonly sets: readonly string[];
}

interface Scale {
  /** Pixels of one spacing step, `--spacing`. */
  readonly step: number;
}

/** The declarations of a node not written yet, which a utility setting several takes from. */
type Rest = Map<string, DeclaredValue>;

type Rule = (value: DeclaredValue, rest: Rest, scale: Scale) => Utility[];

const one = (cls: string, ...sets: string[]): Utility[] => [{ cls, sets }];

/** CSS in an arbitrary value, with the type Tailwind is to read it as when it could read another. */
const arbitrary = (prefix: string, value: string, type?: string) =>
  `${prefix}-${printArbitrary(value, type)}`;

/** A declared value as CSS: a token as its variable, a number as pixels. */
const cssOf = (value: DeclaredValue): string => {
  if (typeof value === "number") {
    return `${value}px`;
  }
  return isToken(value) ? `var(--${tokenName(value)})` : value;
};

/** A declaration no utility says, as Tailwind's arbitrary property: `[mask-size:100%_100%]`. */
const arbitraryProperty = (
  property: string,
  value: DeclaredValue
): Utility[] => {
  const name = property.replace(UPPER_RE, (c) => `-${c.toLowerCase()}`);
  return one(printArbitrary(cssOf(value), name), property);
};

/**
 * A token as a utility. A token of the namespace the utility reads (`$color-primary` for `bg`)
 * is the utility Tailwind generates from it, `bg-primary`; one of another namespace is still
 * the variable, `bg-(--radius-lg)`, with the type Tailwind is to read it as when it could read
 * another (`text-(length:--x)` is a size, not a colour).
 */
const fromToken = (
  prefix: string,
  token: string,
  namespaces: readonly string[],
  type?: string
) => {
  const name = tokenName(token);
  const namespace = namespaces.find((ns) => name.startsWith(`${ns}-`));
  if (namespace !== undefined) {
    return `${prefix}-${name.slice(namespace.length + 1)}`;
  }
  return type === undefined
    ? `${prefix}-(--${name})`
    : `${prefix}-(${type}:--${name})`;
};

/**
 * A length on the spacing scale: a number is the step it lands on (16 over a 4px base is `4`)
 * and pixels only when it is off the scale, which is what brackets say, as the briefing asks of
 * agents.
 */
const spacing = (
  prefix: string,
  value: DeclaredValue,
  scale: Scale
): string => {
  if (typeof value === "number") {
    const step = spacingStepAt(value, scale.step);
    return step === null
      ? arbitrary(prefix, `${value}px`)
      : `${prefix}-${step}`;
  }
  if (value.trim() === "0") {
    return `${prefix}-0`;
  }
  const axis = prefix.at(-1);
  const keyword =
    SIZE_KEYWORDS.keyword(value) ??
    (axis === "w" || axis === "h"
      ? SCREEN_KEYWORDS[axis].keyword(value)
      : undefined);
  if (keyword !== undefined) {
    return `${prefix}-${keyword}`;
  }
  return isToken(value)
    ? fromToken(prefix, value, ["spacing", "container"])
    : arbitrary(prefix, value);
};

/** A spacing class that may go below zero, as a margin can: `-mt-2`. */
const signedSpacing = (
  prefix: string,
  value: DeclaredValue,
  scale: Scale
): string =>
  typeof value === "number" && value < 0
    ? `-${spacing(prefix, -value, scale)}`
    : spacing(prefix, value, scale);

const length =
  (prefix: string, property: string): Rule =>
  (value, _rest, scale) =>
    one(spacing(prefix, value, scale), property);

const color =
  (prefix: string, property: string): Rule =>
  (value) => {
    const text = String(value).trim();
    const keyword = COLOR_KEYWORDS.keyword(text);
    if (keyword !== undefined) {
      return one(`${prefix}-${keyword}`, property);
    }
    return one(
      isToken(text)
        ? fromToken(prefix, text, ["color"])
        : arbitrary(prefix, text),
      property
    );
  };

/**
 * A keyword Tailwind names a utility after, of `values` (`items-center`, `justify-between` for
 * `space-between`, `items-start` for `flex-start`); anything else as CSS.
 */
const named =
  (property: string, prefix: string, values: string): Rule =>
  (value) => {
    const text = String(value);
    return values.split(" ").includes(text)
      ? one(`${prefix}-${text.replace(KEYWORD_HEAD_RE, "")}`, property)
      : arbitraryProperty(property, value);
  };

// ---- Shorthands ----

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
type Side = (typeof SIDES)[number];

/**
 * Padding (`p`) or margin (`m`) side by side: one class for every side, one per axis, else one
 * per side. The first side met takes the others.
 */
const sides =
  (property: "padding" | "margin", letter: "p" | "m", side: Side): Rule =>
  (value, rest, scale) => {
    const at: Partial<Record<Side, DeclaredValue>> = { [side]: value };
    for (const other of SIDES) {
      const name = `${property}${other}`;
      const v = rest.get(name);
      if (v !== undefined) {
        at[other] = v;
        rest.delete(name);
      }
    }
    const cls = (suffix: string, v: DeclaredValue, ...over: Side[]) =>
      one(
        signedSpacing(`${letter}${suffix}`, v, scale),
        ...over.map((s) => `${property}${s}`)
      );
    /** Two opposite sides: one class when they are the same, else one each (`pl`, `pr`). */
    const pair = (suffix: string, a: Side, b: Side): Utility[] => {
      const [first, second] = [at[a], at[b]];
      if (first !== undefined && first === second) {
        return cls(suffix, first, a, b);
      }
      return [
        ...(first === undefined
          ? []
          : cls(a[0]?.toLowerCase() ?? "", first, a)),
        ...(second === undefined
          ? []
          : cls(b[0]?.toLowerCase() ?? "", second, b)),
      ];
    };
    const { Bottom: bottom, Left: left, Right: right, Top: top } = at;
    if (top !== undefined && top === bottom && left === top && right === top) {
      return cls("", top, ...SIDES);
    }
    return [...pair("x", "Left", "Right"), ...pair("y", "Top", "Bottom")];
  };

const sideRules = (property: "padding" | "margin", letter: "p" | "m") =>
  Object.fromEntries(
    SIDES.map((side) => [`${property}${side}`, sides(property, letter, side)])
  );

/** Padding or margin on every side at once: `p-4`, `-m-2`. */
const sidesAtOnce =
  (property: "padding" | "margin", letter: "p" | "m"): Rule =>
  (value, _rest, scale) =>
    one(
      signedSpacing(letter, value, scale),
      ...SIDES.map((side) => `${property}${side}`)
    );

/** `flex-1` for what grows into the free room; `shrink-0` for what does not shrink. */
const flex =
  (property: "flexBasis" | "flexGrow" | "flexShrink"): Rule =>
  (value, rest) => {
    const of = (name: string) =>
      name === property ? String(value) : String(rest.get(name));
    if (
      of("flexGrow") === "1" &&
      of("flexShrink") === "1" &&
      of("flexBasis") === "0%"
    ) {
      rest.delete("flexBasis");
      rest.delete("flexGrow");
      rest.delete("flexShrink");
      return one("flex-1", "flexGrow", "flexShrink", "flexBasis");
    }
    return property === "flexShrink" && value === "0"
      ? one("shrink-0", property)
      : arbitraryProperty(property, value);
  };

/** A border's width, its style with it when it is solid, Tailwind's own. */
const borderWidth: Rule = (value, rest) => {
  if (rest.get("borderStyle") === "solid") {
    rest.delete("borderStyle");
  }
  const sets = ["borderWidth", "borderStyle"];
  if (value === 1) {
    return one("border", ...sets);
  }
  if (typeof value === "number") {
    // Tailwind has a utility for a whole number of pixels only.
    return one(
      Number.isInteger(value) && value >= 0
        ? `border-${value}`
        : arbitrary("border", `${value}px`),
      ...sets
    );
  }
  return one(
    isToken(value)
      ? `border-(length:--${tokenName(value)})`
      : arbitrary("border", value),
    ...sets
  );
};

/** A font size, with the line height of its token when that is the line height. */
const fontSize: Rule = (value, rest) => {
  if (typeof value === "number") {
    return one(arbitrary("text", `${value}px`), "fontSize");
  }
  if (!isToken(value)) {
    return one(arbitrary("text", value, "length"), "fontSize");
  }
  const cls = fromToken("text", value, ["text"], "length");
  // Tailwind's `text-lg` sets the line height its size is paired with; a variable sets none.
  const paired = `$${lineHeightName(tokenName(value))}`;
  if (!cls.includes("(") && rest.get("lineHeight") === paired) {
    rest.delete("lineHeight");
    return one(cls, "fontSize", "lineHeight");
  }
  return one(cls, "fontSize");
};

const fontWeight: Rule = (value) => {
  const text = String(value);
  if (NUMBER_RE.test(text)) {
    const name = weightStepOf(Number(text));
    return one(
      name === undefined ? arbitrary("font", text) : `font-${name}`,
      "fontWeight"
    );
  }
  return one(
    isToken(text)
      ? fromToken("font", text, ["font-weight"])
      : arbitrary("font", text, "weight"),
    "fontWeight"
  );
};

const fontFamily: Rule = (value) => {
  const text = String(value);
  return one(
    isToken(text)
      ? fromToken("font", text, ["font"], "family-name")
      : arbitrary("font", text, "family-name"),
    "fontFamily"
  );
};

const lineHeight: Rule = (value, _rest, scale) => {
  if (typeof value === "number") {
    return one(spacing("leading", value, scale), "lineHeight");
  }
  return one(
    isToken(value)
      ? fromToken("leading", value, ["leading"])
      : arbitrary("leading", value),
    "lineHeight"
  );
};

const letterSpacing: Rule = (value) => {
  if (typeof value === "number") {
    return one(arbitrary("tracking", `${value}px`), "letterSpacing");
  }
  return one(
    isToken(value)
      ? fromToken("tracking", value, ["tracking"])
      : arbitrary("tracking", value),
    "letterSpacing"
  );
};

const radius: Rule = (value) => {
  if (typeof value === "number") {
    if (value === 0) {
      return one("rounded-none", "borderRadius");
    }
    return one(
      value >= 9999 ? "rounded-full" : arbitrary("rounded", `${value}px`),
      "borderRadius"
    );
  }
  return one(
    isToken(value)
      ? fromToken("rounded", value, ["radius"])
      : arbitrary("rounded", value),
    "borderRadius"
  );
};

const shadow: Rule = (value) => {
  const text = String(value).trim();
  if (text === "none") {
    return one("shadow-none", "boxShadow");
  }
  return one(
    isToken(text)
      ? fromToken("shadow", text, ["shadow"])
      : arbitrary("shadow", text),
    "boxShadow"
  );
};

const opacity: Rule = (value) => {
  const text = String(value);
  return NUMBER_RE.test(text)
    ? one(`opacity-${Math.round(Number(text) * 100)}`, "opacity")
    : arbitraryProperty("opacity", value);
};

const order: Rule = (value) => {
  const text = String(value);
  if (!NUMBER_RE.test(text)) {
    return arbitraryProperty("order", value);
  }
  const n = Number(text);
  return one(n < 0 ? `-order-${-n}` : `order-${n}`, "order");
};

const display: Rule = (value) => {
  if (value === "none") {
    return one("hidden", "display");
  }
  return value === "block" || value === "flex"
    ? one(value, "display")
    : arbitraryProperty("display", value);
};

/** Each property a node's declarations set, as the utilities that write it. */
const RULES: Record<string, Rule> = {
  alignItems: named(
    "alignItems",
    "items",
    "baseline center flex-end flex-start stretch"
  ),
  alignSelf: named("alignSelf", "self", "center flex-end flex-start stretch"),
  background: color("bg", "background"),
  borderColor: color("border", "borderColor"),
  borderRadius: radius,
  borderStyle: named("borderStyle", "border", "dashed dotted solid"),
  borderWidth,
  boxShadow: shadow,
  color: color("text", "color"),
  display,
  flexBasis: flex("flexBasis"),
  flexDirection: (value) =>
    value === "column"
      ? one("flex-col", "flexDirection")
      : arbitraryProperty("flexDirection", value),
  flexGrow: flex("flexGrow"),
  flexShrink: flex("flexShrink"),
  flexWrap: named("flexWrap", "flex", "wrap"),
  fontFamily,
  fontSize,
  fontWeight,
  gap: length("gap", "gap"),
  height: length("h", "height"),
  justifyContent: named(
    "justifyContent",
    "justify",
    "center flex-end flex-start space-around space-between"
  ),
  letterSpacing,
  lineHeight,
  margin: sidesAtOnce("margin", "m"),
  maskPosition: named("maskPosition", "mask", "center"),
  maskRepeat: named("maskRepeat", "mask", "no-repeat"),
  maskSize: named("maskSize", "mask", "contain cover"),
  maxHeight: length("max-h", "maxHeight"),
  maxWidth: length("max-w", "maxWidth"),
  minHeight: length("min-h", "minHeight"),
  minWidth: length("min-w", "minWidth"),
  objectFit: named("objectFit", "object", "contain cover fill"),
  opacity,
  order,
  padding: sidesAtOnce("padding", "p"),
  ...sideRules("padding", "p"),
  ...sideRules("margin", "m"),
  textAlign: named("textAlign", "text", "center left right"),
  whiteSpace: named("whiteSpace", "whitespace", "pre-wrap"),
  width: length("w", "width"),
};

/** A node's declarations at one level as utilities, in the order they are declared. */
const utilitiesOf = (declarations: Declarations, scale: Scale): Utility[] => {
  const rest: Rest = new Map(Object.entries(declarations));
  const out: Utility[] = [];
  for (const [property, value] of Object.entries(declarations)) {
    if (!rest.has(property)) {
      continue;
    }
    rest.delete(property);
    if (INITIAL[property] === String(value)) {
      continue;
    }
    const rule = RULES[property];
    out.push(
      ...(rule ? rule(value, rest, scale) : arbitraryProperty(property, value))
    );
  }
  return out;
};

// ---- Breakpoints ----

/** A utility from the level it starts at up to the one it stops at (null: every one above). */
interface Run {
  end: number | null;
  readonly start: number;
  /** Utilities it took over from, which stop where it does. */
  readonly under: Run[];
  readonly utility: Utility;
}

const stop = (run: Run, at: number) => {
  if (run.end === null) {
    run.end = at;
  }
  for (const under of run.under) {
    stop(under, at);
  }
};

/**
 * A node's utilities at every level as one list, mobile-first (ADR 0036): the base's as they
 * are, then what each breakpoint adds with its variant (`md:gap-6`). A utility a breakpoint drops
 * goes on under those that set everything it set (`gap-4` under `md:gap-6`), and is bounded
 * otherwise (`max-md:flex-col`, `md:max-lg:hidden`).
 */
const responsive = (
  levels: readonly (string | null)[],
  sets: readonly (readonly Utility[])[]
): string[] => {
  const runs: Run[] = [];
  const active = new Map<string, Run>();
  sets.forEach((set, level) => {
    const now = new Set(set.map((u) => u.cls));
    const added = set
      .filter((u) => !active.has(u.cls))
      .map((utility): Run => ({ end: null, start: level, under: [], utility }));
    const covered = new Set(added.flatMap((run) => run.utility.sets));
    for (const run of [...active.values()]) {
      if (now.has(run.utility.cls)) {
        continue;
      }
      active.delete(run.utility.cls);
      const { sets: its } = run.utility;
      if (its.every((p) => covered.has(p))) {
        for (const over of added) {
          if (over.utility.sets.some((p) => its.includes(p))) {
            over.under.push(run);
          }
        }
      } else {
        stop(run, level);
      }
    }
    for (const run of added) {
      runs.push(run);
      active.set(run.utility.cls, run);
    }
  });
  return runs.map(({ end, start, utility }) =>
    printClass({
      utility: utility.cls,
      variants: [
        ...(start === 0 ? [] : [`${levels[start]}`]),
        ...(end === null ? [] : [`max-${levels[end]}`]),
      ],
    })
  );
};

/** How Tailwind v4 writes a design's nodes, its spacing step made once. */
export const tailwindClasses = (
  ds: DesignSystem | null | undefined
): ClassWriter => {
  const scale = { step: spacingBasePx(ds?.spacing.base) };
  return {
    classes: (styles: readonly StyleAt[]) =>
      responsive(
        styles.map((s) => s.breakpoint),
        styles.map((s) => utilitiesOf(s.declarations, scale))
      ),
  };
};
