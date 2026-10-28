/**
 * A component's `cva` classes read into the fields of its spec (ADR 0029): `bg-primary` is the
 * root's fill, `text-sm` its font size, `rounded-md` its radius, `h-9 px-4` its height and
 * padding. The base classes are the spec's base, each variant member's its own, and a class
 * behind one state's variant (`hover:`, `focus-visible:`, `disabled:`, `data-open:`,
 * `aria-invalid:`) the state's. Values name a token as pages do (`$color-primary`,
 * `$spacing-4`) where the class names one, and are CSS otherwise (`bg-[#fff]` is `#fff`).
 *
 * What a spec cannot say is left to the code: a class behind any other variant (`dark:`, `sm:`,
 * `group-hover:`, `[&_svg]:`), behind two, a colour with an opacity (`bg-primary/90`), a side of
 * a border or a corner. A variant member's state classes are read only for the member the axis
 * starts in.
 */
import type {
  Border,
  Length,
  Padding,
  Sides,
} from "@ultrapaint/contracts/document";
import {
  ROOT_SLOT,
  type SlotStyles,
  SPEC_STATES,
  type SpecState,
  type SpecStyle,
} from "@ultrapaint/contracts/specs";
import { spacingStepOf } from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import type {
  ComponentStyles,
  SpecFromCode,
} from "@ultrapaint/framework-api/node";
import {
  arbitraryOf,
  groups,
  type Reading,
  radiusOf,
} from "./component-style.ts";

const CLASS_RE =
  /^(bg|text|font|border|rounded|p|px|py|pt|pr|pb|pl|h|w|size|gap|shadow|opacity)(?:-(.+))?$/;
/** A value written as a variable, Tailwind v4's `p-(--gutter)`. */
const VARIABLE_RE = /^\((--[\w-]+)\)$/;
/** The data type an arbitrary value is marked with: `[color:var(--x)]`, `[length:2px]`. */
const HINT_RE = /^([a-z-]+):(.+)$/;
const INTEGER_RE = /^\d+$/;
const NUMBER_RE = /^-?\d*\.?\d+$/;
const PERCENT_RE = /^(-?\d*\.?\d+)%$/;
/** What reads as a length rather than a colour: a number with a unit, or a function of lengths. */
const LENGTH_LIKE_RE =
  /^(?:-?\d*\.?\d+(?:px|r?em|%|vh|vw|svh|dvh|ch|ex|pt|cqw|cqh)|(?:calc|clamp|min|max)\(.*\))$/;
const SPACES_RE = /\s+/;
const IMPORTANT_RE = /^!|!$/g;
const QUOTES_RE = /["']/g;
const UNDERSCORES_RE = /_/g;
const BRACKETED_RE = /\[[^\]]*\]|\([^)]*\)/g;

/** Tailwind's own scales, named as tokens even where the theme read did not list them. */
const TEXT_STEPS = new Set([
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
const WEIGHT_STEPS = new Set([
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
]);
const RADIUS_STEPS = new Set([
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
]);
const SHADOW_STEPS = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]);
const BORDER_STYLES = new Set(["solid", "dashed", "dotted"]);

const COLOUR_KEYWORDS: Readonly<Record<string, string>> = {
  black: "#000",
  current: "currentColor",
  inherit: "inherit",
  transparent: "transparent",
  white: "#fff",
};
const SIZE_KEYWORDS: Readonly<Record<string, string>> = {
  auto: "auto",
  fit: "fit-content",
  full: "100%",
  max: "max-content",
  min: "min-content",
};

/** The state a variant is, as the headless libraries and the browser say it. */
const STATE_OF: Readonly<Record<string, SpecState>> = {
  active: "active",
  "aria-checked": "checked",
  "aria-disabled": "disabled",
  "aria-expanded": "open",
  "aria-invalid": "invalid",
  "data-[disabled]": "disabled",
  "data-[state=checked]": "checked",
  "data-[state=open]": "open",
  "data-checked": "checked",
  "data-disabled": "disabled",
  "data-invalid": "invalid",
  "data-open": "open",
  "data-popup-open": "open",
  disabled: "disabled",
  focus: "focus",
  "focus-visible": "focus",
  hover: "hover",
};

/** A class's variants and its utility: `data-[state=open]:bg-accent`, brackets kept whole. */
const split = (
  cls: string
): { readonly utility: string; readonly variants: readonly string[] } => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < cls.length; i += 1) {
    const char = cls[i];
    if (char === "[" || char === "(") {
      depth += 1;
    } else if (char === "]" || char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === ":" && depth === 0) {
      parts.push(cls.slice(from, i));
      from = i + 1;
    }
  }
  return { utility: cls.slice(from), variants: parts };
};

/** An arbitrary value as CSS, with its type when it is marked with one; none for a scale step. */
const customOf = (
  value: string
): { readonly css: string; readonly hint?: string } | undefined => {
  const [variable] = groups(VARIABLE_RE, value);
  if (variable !== undefined) {
    return { css: `var(${variable})` };
  }
  const inner = arbitraryOf(value);
  if (inner === undefined) {
    return;
  }
  const [hint, rest] = groups(HINT_RE, inner);
  const raw = hint !== undefined && rest !== undefined ? rest : inner;
  // Tailwind writes a space as `_`, except inside a URL.
  const css = raw.includes("url(") ? raw : raw.replace(UNDERSCORES_RE, " ");
  return hint !== undefined && rest !== undefined ? { css, hint } : { css };
};

const colourOf = (value: string, { names }: Reading): string | null => {
  const custom = customOf(value);
  if (custom !== undefined) {
    return custom.hint === undefined || custom.hint === "color"
      ? custom.css
      : null;
  }
  if (names.has(`color-${value}`)) {
    return `$color-${value}`;
  }
  return COLOUR_KEYWORDS[value] ?? null;
};

/** A length an arbitrary value holds; none when it names something else (`[color:…]`). */
const customLengthOf = (value: string): string | null | undefined => {
  const custom = customOf(value);
  if (custom === undefined) {
    return;
  }
  return custom.hint === undefined || custom.hint === "length"
    ? custom.css
    : null;
};

/** A step of the spacing scale, `4` → `$spacing-4`, or a length. */
const spacingOf = (value: string, { names }: Reading): Length | null => {
  const custom = customLengthOf(value);
  if (custom !== undefined) {
    return custom;
  }
  if (value === "px") {
    return "1px";
  }
  const name = `spacing-${value}`;
  return spacingStepOf(name) !== null || names.has(name) ? `$${name}` : null;
};

/** A width or a height: a spacing step, a container, or a keyword. */
const sizeOf = (value: string, reading: Reading): Length | null =>
  spacingOf(value, reading) ??
  (reading.names.has(`container-${value}`) ? `$container-${value}` : null) ??
  SIZE_KEYWORDS[value] ??
  null;

const fontSizeOf = (value: string, { names }: Reading): Length | null =>
  TEXT_STEPS.has(value) || names.has(`text-${value}`) ? `$text-${value}` : null;

const fontWeightOf = (value: string, { names }: Reading): Length | null => {
  if (WEIGHT_STEPS.has(value) || names.has(`font-weight-${value}`)) {
    return `$font-weight-${value}`;
  }
  const custom = customOf(value);
  if (
    custom === undefined ||
    (custom.hint !== undefined && custom.hint !== "number")
  ) {
    return null;
  }
  // `font-[550]` is a weight; `font-['Inter']` a family, which a spec has no field for.
  if (NUMBER_RE.test(custom.css)) {
    return Number(custom.css);
  }
  return custom.css.startsWith("var(") ? custom.css : null;
};

const shadowOf = (value: string | undefined, { names }: Reading) => {
  if (value === undefined) {
    return names.has("shadow") ? "$shadow" : "$shadow-sm";
  }
  if (value === "none") {
    return "none";
  }
  if (SHADOW_STEPS.has(value) || names.has(`shadow-${value}`)) {
    return `$shadow-${value}`;
  }
  const custom = customOf(value);
  return custom !== undefined &&
    (custom.hint === undefined || custom.hint === "shadow")
    ? custom.css
    : null;
};

const opacityOf = (value: string): number | null => {
  const raw = customOf(value)?.css ?? value;
  const [percent] = groups(PERCENT_RE, raw);
  let amount: number | null = null;
  if (percent !== undefined) {
    amount = Number(percent) / 100;
  } else if (INTEGER_RE.test(value)) {
    amount = Number(value) / 100;
  } else if (raw !== value && NUMBER_RE.test(raw)) {
    amount = Number(raw);
  }
  return amount !== null && amount >= 0 && amount <= 1 ? amount : null;
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The fields of one slot, in one variant member or state, as the classes set them. */
interface Draft {
  readonly border: Mutable<Border>;
  readonly fields: Mutable<Omit<SpecStyle, "border" | "padding">>;
  readonly sides: Mutable<Sides>;
}

const draft = (): Draft => ({ border: {}, fields: {}, sides: {} });

/** `border-2`, `border-dashed`, `border-input`, `border-[3px]`: a width, a style or a colour. */
const readBorder = (
  d: Draft,
  value: string | undefined,
  reading: Reading
): void => {
  if (value === undefined) {
    d.border.width = 1;
  } else if (INTEGER_RE.test(value)) {
    d.border.width = Number(value);
  } else if (BORDER_STYLES.has(value)) {
    d.border.style = value as NonNullable<Border["style"]>;
  } else {
    const custom = customOf(value);
    if (
      custom !== undefined &&
      (custom.hint === "length" ||
        (custom.hint === undefined && LENGTH_LIKE_RE.test(custom.css)))
    ) {
      d.border.width = custom.css;
      return;
    }
    const colour = colourOf(value, reading);
    if (colour !== null) {
      d.border.color = colour;
    }
  }
};

/** `text-sm` is a size, `text-primary` a colour, `text-[13px]` a size and `text-[#333]` a colour. */
const readText = (d: Draft, value: string, reading: Reading): void => {
  const size = fontSizeOf(value, reading);
  if (size !== null) {
    d.fields.fontSize = size;
    return;
  }
  const custom = customOf(value);
  if (
    custom !== undefined &&
    (custom.hint === "length" ||
      (custom.hint === undefined && LENGTH_LIKE_RE.test(custom.css)))
  ) {
    d.fields.fontSize = custom.css;
    return;
  }
  const colour = colourOf(value, reading);
  if (colour !== null) {
    d.fields.color = colour;
  }
};

/** Sets a field when the class gives it a value. */
const set = <K extends keyof Draft["fields"]>(
  d: Draft,
  field: K,
  read: Draft["fields"][K] | null
) => {
  if (read !== null && read !== undefined) {
    d.fields[field] = read;
  }
};

const radiusFieldOf = (value: string | undefined, reading: Reading) => {
  if (value === undefined) {
    // `rounded` is the theme's `--radius`, else Tailwind's 0.25rem.
    return radiusOf(value, reading) ?? "0.25rem";
  }
  return (
    radiusOf(value, reading) ??
    (RADIUS_STEPS.has(value) ? `$radius-${value}` : null)
  );
};

const readPadding =
  (sides: readonly (keyof Sides)[]) =>
  (d: Draft, value: string, reading: Reading) => {
    const length = spacingOf(value, reading);
    if (length === null) {
      return;
    }
    for (const side of sides) {
      d.sides[side] = length;
    }
  };

const readSize =
  (fields: readonly ("height" | "width")[]) =>
  (d: Draft, value: string, reading: Reading) => {
    const size = sizeOf(value, reading);
    for (const field of fields) {
      set(d, field, size);
    }
  };

/** What each utility sets on a slot's draft, given a value. */
const READERS: Readonly<
  Record<string, (d: Draft, value: string, reading: Reading) => void>
> = {
  bg: (d, v, r) => set(d, "fill", colourOf(v, r)),
  font: (d, v, r) => set(d, "fontWeight", fontWeightOf(v, r)),
  gap: (d, v, r) => set(d, "gap", spacingOf(v, r)),
  h: readSize(["height"]),
  opacity: (d, v) => set(d, "opacity", opacityOf(v)),
  p: readPadding(["top", "right", "bottom", "left"]),
  pb: readPadding(["bottom"]),
  pl: readPadding(["left"]),
  pr: readPadding(["right"]),
  pt: readPadding(["top"]),
  px: readPadding(["right", "left"]),
  py: readPadding(["top", "bottom"]),
  size: readSize(["height", "width"]),
  text: readText,
  w: readSize(["width"]),
};

/** Sets what one utility says on a slot's draft; a utility a spec has no field for does nothing. */
const apply = (d: Draft, utility: string, reading: Reading): void => {
  const [use, value] = groups(CLASS_RE, utility);
  if (use === "border") {
    readBorder(d, value, reading);
  } else if (use === "rounded") {
    set(d, "radius", radiusFieldOf(value, reading));
  } else if (use === "shadow") {
    set(d, "shadow", shadowOf(value, reading));
  } else if (use !== undefined && value !== undefined) {
    READERS[use]?.(d, value, reading);
  }
};

/** One value for every side when they agree, else the sides set, top first. */
const paddingOf = ({ bottom, left, right, top }: Sides): Padding | null => {
  if (top !== undefined && top === right && top === bottom && top === left) {
    return top;
  }
  const sides: Mutable<Sides> = {};
  for (const [side, length] of [
    ["top", top],
    ["right", right],
    ["bottom", bottom],
    ["left", left],
  ] as const) {
    if (length !== undefined) {
      sides[side] = length;
    }
  }
  return Object.keys(sides).length > 0 ? sides : null;
};

/** The slots a draft sets fields of: the root's, or none. */
const slotsOf = (d: Draft): SlotStyles | null => {
  const style: Mutable<SpecStyle> = { ...d.fields };
  if (Object.keys(d.border).length > 0) {
    style.border = { ...d.border };
  }
  const padding = paddingOf(d.sides);
  if (padding !== null) {
    style.padding = padding;
  }
  return Object.keys(style).length > 0 ? { [ROOT_SLOT]: style } : null;
};

export const componentSpec = (
  styles: ComponentStyles,
  tokens: readonly SourceToken[]
): SpecFromCode => {
  const reading: Reading = { names: new Set(tokens.map((t) => t.name)) };
  const states = new Map<SpecState, Draft>();
  /** Reads a class list into `into`, and its state classes into the states when `stateful`. */
  const read = (classes: string, into: Draft, stateful: boolean) => {
    for (const raw of classes.split(SPACES_RE)) {
      const { utility, variants } = split(raw.replace(IMPORTANT_RE, ""));
      // `bg-primary/90`: a colour with an opacity, which a field cannot hold.
      if (utility === "" || utility.replace(BRACKETED_RE, "").includes("/")) {
        continue;
      }
      const [variant, ...more] = variants;
      if (variant === undefined) {
        // A later class wins, as it does in the class list.
        apply(into, utility, reading);
        continue;
      }
      const state = STATE_OF[variant.replace(QUOTES_RE, "")];
      if (stateful && state !== undefined && more.length === 0) {
        const target = states.get(state) ?? draft();
        states.set(state, target);
        apply(target, utility, reading);
      }
    }
  };

  const base = draft();
  read(styles.base, base, true);
  const variants: Record<string, Record<string, SlotStyles>> = {};
  for (const [axis, members] of Object.entries(styles.classes)) {
    for (const [member, classes] of Object.entries(members)) {
      const own = draft();
      read(classes, own, styles.defaults[axis] === member);
      const slots = slotsOf(own);
      if (slots !== null) {
        variants[axis] = { ...variants[axis], [member]: slots };
      }
    }
  }
  const stateStyles: Record<string, SlotStyles> = {};
  for (const state of SPEC_STATES) {
    const d = states.get(state);
    const slots = d === undefined ? null : slotsOf(d);
    if (slots !== null) {
      stateStyles[state] = slots;
    }
  }
  return {
    base: slotsOf(base) ?? {},
    defaults: { ...styles.defaults },
    states: stateStyles,
    variants,
  };
};
