/**
 * An element's Tailwind v4 classes read back into declarations (ADR 0024), the other way of
 * `node-classes.ts`: what markup pasted on the canvas sets with its classes. A class naming a
 * token of the design system is that token (`bg-primary` is `$color-primary`), a step of the
 * spacing scale its `$spacing-*` whatever the base, a default of Tailwind's theme the design system
 * does not declare its CSS (`default-theme.ts`), an arbitrary value or property the CSS it holds,
 * a length in pixels a number. A utility it does not know and every class with a variant (`md:`,
 * `hover:`) it names and leaves unread. Pure.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  ClassReader,
  ClassReading,
  DeclaredValue,
} from "@ultrapaint/contracts/node-style";
import {
  nameOfVariable,
  spacingBasePx,
  spacingStepName,
  spacingStepOf,
  tokenOf,
} from "@ultrapaint/contracts/token-table";
import {
  formatNumber,
  parseColor,
  parseLength,
  resolveCalc,
} from "@ultrapaint/contracts/token-value";
import { isToken, tokenName } from "@ultrapaint/design-document/tokens";
import { DEFAULT_THEME } from "./default-theme.ts";
import {
  arbitraryOf,
  BORDER_STYLES,
  COLOR_KEYWORDS,
  colorNamespaces,
  DISPLAY_UTILITIES,
  KEYWORD_UTILITIES,
  lengthKeywords,
  POSITION_UTILITIES,
  parseClass,
  splitModifier,
  TEXT_ALIGNS,
  utilityReader,
  WEIGHT_STEPS,
} from "./utilities.ts";

type Declared = Record<string, DeclaredValue>;

/** What a class reads as: its declarations, or null when it says nothing the reader knows. */
type Read = (value: string | undefined) => Declared | null;

interface Rule {
  /**
   * When it applies among the element's classes, lowest first, as Tailwind orders its rules: a
   * side's padding after every side's (`p-4 pt-2`), a line height after a size's (`text-lg
   * leading-7`).
   */
  readonly rank: number;
  readonly read: Read;
  /** Whether it takes a minus, `-mt-2`. */
  readonly signed?: boolean;
}

/** A class's declarations and the rank they apply at. */
interface Applied {
  readonly declared: Declared;
  readonly rank: number;
}

const STEP_RE = /^\d+(?:\.\d+)?$/;
const NUMBER_RE = /^\d*\.?\d+$/;
const FRACTION_RE = /^(\d+)\/(\d+)$/;
const WHOLE_VAR_RE = /^var\(\s*(--[\w-]+)\s*\)$/;
const PERCENT_RE = /^(-?\d*\.?\d+)%$/;
const KEBAB_RE = /-([a-z])/g;
const PROPERTY_RE = /^[a-z][a-z-]*$/;

/** Bare `rounded`, which Tailwind compiles to a length of its own rather than a token. */
const BARE_RADIUS = "0.25rem";

/** What the classes' tokens read as, the design system made once. */
interface Theme {
  /** CSS from a class: a variable of a token the design system declares as `$name`, pixels a number. */
  readonly fromCss: (css: string) => DeclaredValue;
  /** One step of the spacing scale in pixels. */
  readonly stepPx: number;
  /** The first of these tokens the design system declares, as `$name`; else the default's CSS. */
  readonly tokenOrDefault: (
    names: readonly string[]
  ) => DeclaredValue | undefined;
}

const themeOf = (ds: DesignSystem | null | undefined): Theme => {
  const declared = (name: string) => tokenOf(ds, name) !== undefined;
  return {
    fromCss: (css) => {
      const whole: RegExpExecArray | null = WHOLE_VAR_RE.exec(css);
      const variable = whole?.[1];
      if (variable !== undefined && declared(nameOfVariable(variable))) {
        return `$${nameOfVariable(variable)}`;
      }
      const length = parseLength(css);
      return length?.unit === "px" ? length.value : css;
    },
    stepPx: spacingBasePx(ds?.spacing.base),
    tokenOrDefault: (names) => {
      const own = names.find(declared);
      if (own !== undefined) {
        return `$${own}`;
      }
      const fallback = names.find((name) => DEFAULT_THEME.has(name));
      return fallback === undefined ? undefined : DEFAULT_THEME.get(fallback);
    },
  };
};

/** A value that is a token of `prefix` or an arbitrary value: `rounded-lg`, `rounded-[6px]`. */
const tokenOrArbitrary = (
  theme: Theme,
  prefix: string,
  value: string
): DeclaredValue | undefined => {
  const arbitrary = arbitraryOf(value);
  return arbitrary === undefined
    ? theme.tokenOrDefault([`${prefix}-${value}`])
    : theme.fromCss(arbitrary.css);
};

/** A fraction of the room, `1/2` → `50%`. */
const fractionOf = (value: string): string | undefined => {
  const fraction: RegExpExecArray | null = FRACTION_RE.exec(value);
  const [, a, b] = fraction ?? [];
  return a === undefined || b === undefined || Number(b) === 0
    ? undefined
    : `${formatNumber((Number(a) / Number(b)) * 100)}%`;
};

/** The same value on each of these properties. */
const each = (properties: readonly string[], value: DeclaredValue): Declared =>
  Object.fromEntries(properties.map((p) => [p, value]));

interface SpacingOptions {
  /** Whether it takes a fraction of the room, `w-1/2`. */
  readonly fractions?: boolean;
  /** The namespaces of the tokens it names, `container` for `max-w-md`. */
  readonly namespaces?: readonly string[];
}

/**
 * A length a spacing utility takes: a step of the scale as its token (`4` → `$spacing-4`), `px`
 * one pixel, a keyword the utility takes (`w-full`), a fraction where it takes one (`w-1/2`), a
 * named token of `namespaces` (`max-w-md` → `container-md`), an arbitrary value.
 */
const spacingOf = (
  theme: Theme,
  use: string,
  value: string | undefined,
  { fractions = false, namespaces = ["spacing"] }: SpacingOptions = {}
): DeclaredValue | undefined => {
  if (value === undefined) {
    return;
  }
  const arbitrary = arbitraryOf(value);
  if (arbitrary !== undefined) {
    return arbitrary.css === "0" ? 0 : theme.fromCss(arbitrary.css);
  }
  if (value === "0") {
    return 0;
  }
  if (value === "px") {
    return 1;
  }
  if (STEP_RE.test(value)) {
    return `$${spacingStepName(Number(value))}`;
  }
  return (
    (fractions ? fractionOf(value) : undefined) ??
    lengthKeywords(use).css(value) ??
    theme.tokenOrDefault(namespaces.map((ns) => `${ns}-${value}`))
  );
};

/** A length below zero, for a utility written with a minus: a step in pixels, as it has no token. */
const negated = (theme: Theme, value: DeclaredValue): DeclaredValue => {
  if (typeof value === "number") {
    return value === 0 ? 0 : -value;
  }
  if (NUMBER_RE.test(value)) {
    return `-${value}`;
  }
  const step = isToken(value) ? spacingStepOf(tokenName(value)) : null;
  return step === null ? `calc(${value} * -1)` : -step * theme.stepPx;
};

/**
 * A colour mixed with transparency, `/50`: as CSS, a token inside it only in a fill (ADR 0134),
 * as its variable anywhere else.
 */
const withOpacity = (
  color: DeclaredValue,
  modifier: string,
  inFill: boolean
) => {
  if (modifier === "") {
    return color;
  }
  const raw = modifier.slice(1);
  const arbitrary = arbitraryOf(raw)?.css;
  const percent: RegExpExecArray | null =
    arbitrary === undefined ? null : PERCENT_RE.exec(arbitrary);
  const amount =
    arbitrary === undefined
      ? Number(raw)
      : Number(percent?.[1] ?? Number(arbitrary) * 100);
  if (Number.isNaN(amount)) {
    return;
  }
  const text = String(color);
  const css = inFill || !isToken(text) ? text : `var(--${tokenName(text)})`;
  return `color-mix(in oklab, ${css} ${formatNumber(amount)}%, transparent)`;
};

/**
 * A colour a colour utility takes: CSS's keywords and Tailwind's black and white, a token of the
 * namespaces the utility reads (`bg-primary`), a default of the palette (`bg-blue-500`), an
 * arbitrary colour; with its opacity (`/50`).
 */
const colorOf = (
  theme: Theme,
  use: string,
  value: string | undefined
): DeclaredValue | undefined => {
  if (value === undefined) {
    return;
  }
  const { modifier, value: name } = splitModifier(value);
  const arbitrary = arbitraryOf(name);
  let color: DeclaredValue | undefined;
  if (arbitrary === undefined) {
    color =
      COLOR_KEYWORDS.css(name) ??
      theme.tokenOrDefault(colorNamespaces(use).map((ns) => `${ns}${name}`));
  } else if (
    arbitrary.hint === "color" ||
    (arbitrary.hint === undefined &&
      (parseColor(arbitrary.css) !== null || WHOLE_VAR_RE.test(arbitrary.css)))
  ) {
    color = theme.fromCss(arbitrary.css);
  }
  return color === undefined
    ? undefined
    : withOpacity(color, modifier, use === "bg");
};

/** Whether an arbitrary value of a utility that takes a length or a colour is a length. */
const isLengthArbitrary = (value: string | undefined) => {
  const arbitrary = value === undefined ? undefined : arbitraryOf(value);
  if (arbitrary === undefined) {
    return false;
  }
  if (arbitrary.hint !== undefined) {
    return arbitrary.hint === "length";
  }
  return parseLength(arbitrary.css) !== null || arbitrary.css === "0";
};

const bare =
  (declared: Declared): Read =>
  (value) =>
    value === undefined ? declared : null;

/** A keyword utility: `items-center` → `alignItems: center`. */
const keyword =
  ({ property, values }: (typeof KEYWORD_UTILITIES)[string]): Read =>
  (value) => {
    const css = value === undefined ? undefined : values[value];
    return css === undefined ? null : { [property]: css };
  };

/** Line height from a type size's modifier (`text-sm/6`) or a `leading-*` utility. */
const leadingOf = (
  theme: Theme,
  value: string | undefined
): DeclaredValue | undefined => {
  if (value === undefined) {
    return;
  }
  if (value === "none") {
    return "1";
  }
  if (STEP_RE.test(value)) {
    return `$${spacingStepName(Number(value))}`;
  }
  return tokenOrArbitrary(theme, "leading", value);
};

/** A type size and the line height it brings: a token's paired one, as the writer pairs it. */
const sizeOf = (theme: Theme, value: string): Declared | null => {
  const { modifier, value: name } = splitModifier(value);
  const size = tokenOrArbitrary(theme, "text", name);
  if (size === undefined) {
    return null;
  }
  if (modifier !== "") {
    const leading = leadingOf(theme, modifier.slice(1));
    return leading === undefined
      ? null
      : { fontSize: size, lineHeight: leading };
  }
  if (arbitraryOf(name) !== undefined) {
    return { fontSize: size };
  }
  const paired = `text-${name}--line-height`;
  const lineHeight = isToken(size)
    ? `$${paired}`
    : resolveCalc(DEFAULT_THEME.get(paired) ?? "");
  return lineHeight === null || lineHeight === ""
    ? { fontSize: size }
    : { fontSize: size, lineHeight };
};

const SIDES = {
  b: ["Bottom"],
  e: ["Right"],
  l: ["Left"],
  r: ["Right"],
  s: ["Left"],
  t: ["Top"],
  x: ["Left", "Right"],
  y: ["Top", "Bottom"],
} as const;
const ALL_SIDES = ["Top", "Right", "Bottom", "Left"] as const;

/** The rank of a shorthand, an axis and a side, so the narrower wins: `p`, `px`, `pt`. */
const rankOf = (sides: readonly string[]) =>
  sides.length === ALL_SIDES.length ? 0 : 3 - Math.min(sides.length, 2);

/** What `flex-*` sets with a value: a direction, a wrap, or how it grows. */
const FLEX_VALUES: Readonly<Record<string, Declared>> = {
  "1": { flexBasis: "0%", flexGrow: "1", flexShrink: "1" },
  auto: { flexBasis: "auto", flexGrow: "1", flexShrink: "1" },
  col: { flexDirection: "column" },
  "col-reverse": { flexDirection: "column-reverse" },
  initial: { flexBasis: "auto", flexGrow: "0", flexShrink: "1" },
  none: { flexBasis: "auto", flexGrow: "0", flexShrink: "0" },
  nowrap: { flexWrap: "nowrap" },
  row: { flexDirection: "row" },
  "row-reverse": { flexDirection: "row-reverse" },
  wrap: { flexWrap: "wrap" },
  "wrap-reverse": { flexWrap: "wrap-reverse" },
};

const ORDERS: Readonly<Record<string, string>> = {
  first: "-9999",
  last: "9999",
  none: "0",
};

/** The rules, by the utility each reads: the design system's tokens and its scale made once. */
const rulesOf = (theme: Theme): Record<string, Rule> => {
  const rules: Record<string, Rule> = {};
  const add = (use: string, read: Read, rank = 0, signed = false) => {
    rules[use] = { rank, read, signed };
  };
  /** Spacing set on each of `properties`: `gap-x-2`, `inset-0`, `size-4`. */
  const lengths = (
    use: string,
    properties: readonly string[],
    rank: number,
    { signed = false, ...options }: SpacingOptions & { signed?: boolean } = {}
  ) =>
    add(
      use,
      (value) => {
        const length = spacingOf(theme, use, value, options);
        return length === undefined ? null : each(properties, length);
      },
      rank,
      signed
    );

  for (const [use, display] of Object.entries(DISPLAY_UTILITIES)) {
    add(use, bare({ display }));
  }
  for (const position of POSITION_UTILITIES) {
    add(position, bare({ position }));
  }
  for (const [use, utility] of Object.entries(KEYWORD_UTILITIES)) {
    add(use, keyword(utility));
  }

  // `flex` is a display bare and a flex's direction, wrap or growth with a value.
  add("flex", (value) =>
    value === undefined ? { display: "flex" } : (FLEX_VALUES[value] ?? null)
  );
  const growth = (property: string) => (value: string | undefined) => {
    if (value === undefined) {
      return { [property]: "1" };
    }
    const css = arbitraryOf(value)?.css ?? value;
    return STEP_RE.test(css) ? { [property]: css } : null;
  };
  add("grow", growth("flexGrow"), 1);
  add("shrink", growth("flexShrink"), 1);
  lengths("basis", ["flexBasis"], 1, {
    fractions: true,
    namespaces: ["container"],
  });

  // Gap, padding, margin and the inset, each on every side, an axis or a side.
  lengths("gap", ["gap"], 0);
  lengths("gap-x", ["columnGap"], 1);
  lengths("gap-y", ["rowGap"], 1);
  for (const [letter, property, signed] of [
    ["p", "padding", false],
    ["m", "margin", true],
  ] as const) {
    lengths(
      letter,
      ALL_SIDES.map((side) => `${property}${side}`),
      0,
      { signed }
    );
    for (const [side, sides] of Object.entries(SIDES)) {
      lengths(
        `${letter}${side}`,
        sides.map((s) => `${property}${s}`),
        rankOf(sides),
        { signed }
      );
    }
  }
  const insets: [string, readonly string[]][] = [
    ["inset", ["top", "right", "bottom", "left"]],
    ["inset-x", ["left", "right"]],
    ["inset-y", ["top", "bottom"]],
    ["top", ["top"]],
    ["right", ["right"]],
    ["bottom", ["bottom"]],
    ["left", ["left"]],
    ["start", ["left"]],
    ["end", ["right"]],
  ];
  for (const [use, properties] of insets) {
    lengths(use, properties, rankOf(properties), {
      fractions: true,
      signed: true,
    });
  }

  // Sizes.
  const sizes: [string, readonly string[]][] = [
    ["w", ["width"]],
    ["h", ["height"]],
    ["size", ["width", "height"]],
    ["min-w", ["minWidth"]],
    ["min-h", ["minHeight"]],
    ["max-w", ["maxWidth"]],
    ["max-h", ["maxHeight"]],
  ];
  for (const [use, properties] of sizes) {
    lengths(use, properties, use === "size" ? 0 : 1, {
      fractions: true,
      namespaces: ["spacing", "container"],
    });
  }

  // Fill, border, corners, shadow, opacity.
  add("bg", (value) => {
    const color = colorOf(theme, "bg", value);
    if (color !== undefined) {
      return { background: color };
    }
    const arbitrary = value === undefined ? undefined : arbitraryOf(value);
    // An image or a gradient written out is a fill too; a size or a position is not.
    return arbitrary !== undefined &&
      (arbitrary.hint === undefined || arbitrary.hint === "image")
      ? { background: arbitrary.css }
      : null;
  });
  add("border", (value): Declared | null => {
    if (value === undefined) {
      return { borderStyle: "solid", borderWidth: 1 };
    }
    if (STEP_RE.test(value)) {
      return { borderStyle: "solid", borderWidth: Number(value) };
    }
    if (isLengthArbitrary(value)) {
      const css = arbitraryOf(value)?.css ?? "";
      return { borderStyle: "solid", borderWidth: theme.fromCss(css) };
    }
    const color = colorOf(theme, "border", value);
    return color === undefined ? null : { borderColor: color };
  });
  for (const style of BORDER_STYLES) {
    add(`border-${style}`, bare({ borderStyle: style }), 1);
  }
  add("rounded", (value) => {
    if (value === undefined) {
      return { borderRadius: BARE_RADIUS };
    }
    if (value === "none") {
      return { borderRadius: 0 };
    }
    if (value === "full") {
      return { borderRadius: 9999 };
    }
    const radius = tokenOrArbitrary(theme, "radius", value);
    return radius === undefined ? null : { borderRadius: radius };
  });
  add("shadow", (value) => {
    if (value === undefined) {
      // Bare `shadow` is the small one's value, written out.
      const small = DEFAULT_THEME.get("shadow-sm");
      return small === undefined ? null : { boxShadow: small };
    }
    if (value === "none") {
      return { boxShadow: "none" };
    }
    const hint = arbitraryOf(value)?.hint;
    if (hint !== undefined && hint !== "shadow") {
      return null;
    }
    const shadow = tokenOrArbitrary(theme, "shadow", value);
    return shadow === undefined ? null : { boxShadow: shadow };
  });
  add("opacity", (value) => {
    if (value === undefined) {
      return null;
    }
    const css = arbitraryOf(value)?.css ?? value;
    const percent: RegExpExecArray | null = PERCENT_RE.exec(css);
    if (percent?.[1] !== undefined) {
      return { opacity: formatNumber(Number(percent[1]) / 100) };
    }
    if (!NUMBER_RE.test(css)) {
      return null;
    }
    // A step is a percentage, `opacity-50`; a value in brackets a fraction, `opacity-[.5]`.
    return {
      opacity: formatNumber(css === value ? Number(css) / 100 : Number(css)),
    };
  });
  add("invisible", bare({ visibility: "hidden" }));
  add("visible", bare({ visibility: "visible" }));
  add(
    "order",
    (value) => {
      if (value === undefined) {
        return null;
      }
      const css = ORDERS[value] ?? arbitraryOf(value)?.css ?? value;
      return STEP_RE.test(css) || ORDERS[value] !== undefined
        ? { order: css }
        : null;
    },
    0,
    true
  );

  // Type.
  add("text", (value) => {
    if (value === undefined) {
      return null;
    }
    const align = TEXT_ALIGNS[value];
    if (align !== undefined) {
      return { textAlign: align };
    }
    if (isLengthArbitrary(splitModifier(value).value)) {
      return sizeOf(theme, value);
    }
    const color = colorOf(theme, "text", value);
    return color === undefined ? sizeOf(theme, value) : { color };
  });
  add(
    "leading",
    (value) => {
      const lineHeight = leadingOf(theme, value);
      return lineHeight === undefined ? null : { lineHeight };
    },
    1
  );
  add(
    "tracking",
    (value) => {
      const tracking =
        value === undefined
          ? undefined
          : tokenOrArbitrary(theme, "tracking", value);
      return tracking === undefined ? null : { letterSpacing: tracking };
    },
    0,
    true
  );
  add("font", (value): Declared | null => {
    if (value === undefined) {
      return null;
    }
    const weight = WEIGHT_STEPS.get(value);
    if (weight !== undefined) {
      // Tailwind's theme declares every weight step; the design system may name its own.
      return {
        fontWeight:
          theme.tokenOrDefault([`font-weight-${value}`]) ?? String(weight),
      };
    }
    const arbitrary = arbitraryOf(value);
    if (arbitrary === undefined) {
      const family = theme.tokenOrDefault([`font-${value}`]);
      return family === undefined ? null : { fontFamily: family };
    }
    if (
      arbitrary.hint === "weight" ||
      (arbitrary.hint === undefined && STEP_RE.test(arbitrary.css))
    ) {
      return { fontWeight: arbitrary.css };
    }
    return { fontFamily: theme.fromCss(arbitrary.css) };
  });
  return rules;
};

/**
 * An arbitrary property, `[left:24px]`, as the declaration it is, which the class writer writes
 * for CSS no utility says; none for a custom property or anything else in brackets.
 */
const arbitraryProperty = (theme: Theme, utility: string): Declared | null => {
  const arbitrary = arbitraryOf(utility);
  if (
    !utility.startsWith("[") ||
    arbitrary?.hint === undefined ||
    !PROPERTY_RE.test(arbitrary.hint)
  ) {
    return null;
  }
  const property = arbitrary.hint.replace(KEBAB_RE, (_, c: string) =>
    c.toUpperCase()
  );
  return { [property]: theme.fromCss(arbitrary.css) };
};

/** How Tailwind v4 reads an element's classes, the design system's tokens made once. */
export const tailwindClassReader = (
  ds: DesignSystem | null | undefined
): ClassReader => {
  const theme = themeOf(ds);
  const rules = rulesOf(theme);
  const utility = utilityReader(Object.keys(rules));
  /** What one class without a variant sets, and its rank; null when it sets nothing known. */
  const readOne = (cls: string): Applied | null => {
    const parsed = parseClass(cls);
    const property = parsed.negative
      ? null
      : arbitraryProperty(theme, parsed.utility);
    if (property !== null) {
      return { declared: property, rank: 0 };
    }
    const found = utility(parsed.utility);
    const rule = found === null ? undefined : rules[found.use];
    if (rule === undefined || (parsed.negative && !rule.signed)) {
      return null;
    }
    const declared = rule.read(found?.value);
    if (declared === null) {
      return null;
    }
    return {
      declared: parsed.negative
        ? Object.fromEntries(
            Object.entries(declared).map(([p, v]) => [p, negated(theme, v)])
          )
        : declared,
      rank: rule.rank,
    };
  };
  return {
    read: (classes): ClassReading => {
      const unread: string[] = [];
      const variants: string[] = [];
      const applied: Applied[] = [];
      for (const cls of classes) {
        if (parseClass(cls).variants.length > 0) {
          variants.push(cls);
          continue;
        }
        const one = readOne(cls);
        if (one === null) {
          unread.push(cls);
        } else {
          applied.push(one);
        }
      }
      const declarations: Declared = {};
      for (const { declared } of applied.toSorted((a, b) => a.rank - b.rank)) {
        Object.assign(declarations, declared);
      }
      return { declarations, unread, variants };
    },
  };
};
