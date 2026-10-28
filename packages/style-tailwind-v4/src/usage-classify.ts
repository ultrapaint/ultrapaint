/**
 * A use held against the design system: what kind of value it is (a colour, a spacing, a type
 * size…) and whether it is the design system's own, Tailwind's default, or written out.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  UsageKind,
  UsageStatus,
} from "@ultrapaint/contracts/design-system-setup";
import { spacingStepOf } from "@ultrapaint/contracts/token-table";
import type {
  UsageContext,
  UsageOccurrence,
} from "@ultrapaint/framework-api/node";
import {
  COLOR_SET,
  ELEMENT_COMPONENTS,
  FUNCTION_COLOR_RE,
  HEX_RE,
  isColorLiteral,
  NAMED_COLORS,
  normaliseColor,
  RADIUS_SET,
  SPACING_SET,
} from "./usage-vocabulary.ts";

const HEX_IN_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const WHOLE_VAR_RE = /^var\(\s*--([\w-]+)\s*(?:,[^)]*)?\)$/;
const VAR_ALL_RE = /var\(\s*--([\w-]+)/g;
const PALETTE_RE = /^[a-z]+-\d{2,3}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const LENGTH_RE = /^-?\d*\.?\d+(px|rem|em)$/;
const LENGTH_IN_RE = /-?\d*\.?\d+(px|rem|em)\b/g;
const TYPE_HINT_RE = /^([a-z-]+):(.+)$/;
const UNDERSCORE_RE = /_/g;
const DASHED_RE = /-([a-z])/g;

/** Tailwind's own scales, which a design system has unless it says otherwise. */
const DEFAULT_SIZES = new Set([
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
const DEFAULT_WEIGHTS = new Set([
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
const DEFAULT_RADII = new Set([
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
]);
const DEFAULT_SHADOWS = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]);
const DEFAULT_LAYERS = new Set(["0", "10", "20", "30", "40", "50"]);
/** Colours that are not a decision: nothing to put on the design system. */
const NO_COLOR = new Set(["transparent", "current", "inherit", "none"]);

const STYLE_COLOR = new Set([
  "background",
  "backgroundColor",
  "borderBottomColor",
  "borderColor",
  "borderLeftColor",
  "borderRightColor",
  "borderTopColor",
  "caretColor",
  "color",
  "fill",
  "outlineColor",
  "stroke",
  "textDecorationColor",
]);
const STYLE_SPACING = new Set([
  "bottom",
  "columnGap",
  "gap",
  "inset",
  "left",
  "margin",
  "marginBlock",
  "marginBottom",
  "marginInline",
  "marginLeft",
  "marginRight",
  "marginTop",
  "padding",
  "paddingBlock",
  "paddingBottom",
  "paddingInline",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "right",
  "rowGap",
  "top",
]);
const STYLE_KIND: Record<string, UsageKind> = {
  borderRadius: "radius",
  boxShadow: "shadow",
  fontSize: "fontSize",
  fontWeight: "fontWeight",
  zIndex: "zIndex",
};

/** A use held against the design system: what kind of value it is, and whose. */
export interface Classified {
  readonly kind: UsageKind;
  /** In a style or a declaration, the value as it is written there. */
  readonly literal?: string;
  readonly status: UsageStatus;
  readonly token?: string;
  readonly value: string;
}

export interface Known {
  /** Each colour value, normalised, and the first colour token that has it. */
  readonly colorByValue: Map<string, string>;
  readonly colors: Set<string>;
  readonly layers: Set<string>;
  readonly radii: Set<string>;
  readonly shadows: Set<string>;
  readonly sizes: Set<string>;
  readonly spacing: Set<string>;
  readonly weights: Set<string>;
}

export const knownOf = (
  ds: DesignSystem,
  own: readonly string[] | null
): Known => {
  // Before a design system is saved, the theme's scan stands in for it, Tailwind's defaults
  // included; only what the repository declares itself counts as its own then.
  const mine = own ? new Set(own) : null;
  const keep = (name: string) => mine === null || mine.has(name);
  const names = (tokens: readonly { readonly name: string }[] | undefined) =>
    new Set((tokens ?? []).map((t) => t.name).filter(keep));
  const colorTokens = new Map<string, string>();
  for (const group of ds.colors) {
    for (const token of group.tokens) {
      if (keep(token.name)) {
        colorTokens.set(token.name, token.value);
      }
    }
  }
  const colorByValue = new Map<string, string>();
  for (const [name, value] of colorTokens) {
    const normalised = normaliseColor(value);
    if (!colorByValue.has(normalised)) {
      colorByValue.set(normalised, name);
    }
  }
  return {
    colorByValue,
    colors: new Set(colorTokens.keys()),
    layers: new Set(
      (ds.elevation ?? []).flatMap((level) =>
        level.layer === undefined ? [] : [String(level.layer)]
      )
    ),
    radii: names(ds.radius),
    shadows: names(ds.shadows),
    sizes: names(ds.typography.sizes),
    spacing: names(ds.spacing.tokens),
    weights: names(ds.typography.weights),
  };
};

const rawColor = (known: Known, literal: string): Classified => {
  const value = normaliseColor(literal);
  // The colour token whose value is exactly this literal.
  const token = known.colorByValue.get(value);
  return {
    kind: "color",
    literal: literal.trim(),
    status: "raw",
    value,
    ...(token !== undefined && { token }),
  };
};

/** The namespace of a kind's tokens: `var(--primary)` is `color-primary` when that exists. */
const NAMESPACE: Partial<Record<UsageKind, string>> = {
  color: "color",
  fontSize: "text",
  fontWeight: "font-weight",
  radius: "radius",
  shadow: "shadow",
  spacing: "spacing",
};

/**
 * `var(--color-primary)` as the token it names. A custom property the design system has no token
 * for (`--card-spacing`) passes a value on from elsewhere, where it is counted: null.
 */
const fromVar = (
  kind: UsageKind,
  name: string,
  known: Set<string>
): Classified | null => {
  const namespaced = `${NAMESPACE[kind] ?? ""}-${name}`;
  const token = [name, namespaced].find((n) => known.has(n));
  return token ? { kind, status: "system", token, value: token } : null;
};

/** The custom property an arbitrary value is, when it is nothing but `var(--name)`. */
const wholeVar = (inside: string) => {
  const match: RegExpExecArray | null = WHOLE_VAR_RE.exec(inside);
  return match?.[1] ?? null;
};

/** `calc(…)`, `var(--a) * 2`, `--spacing(3)`: worked out, not written out. */
const isComputed = (inside: string) =>
  inside.includes("var(") || inside.includes("calc(") || inside.includes("--");

/** `[…]` of an arbitrary class: its inside with underscores as spaces, and its type hint. */
const arbitrary = (value: string) => {
  if (!(value.startsWith("[") && value.endsWith("]"))) {
    if (value.startsWith("(") && value.endsWith(")")) {
      return { hint: "", inside: `var(${value.slice(1, -1)})` };
    }
    return null;
  }
  const inside = value.slice(1, -1).replace(UNDERSCORE_RE, " ").trim();
  const hinted: RegExpExecArray | null = TYPE_HINT_RE.exec(inside);
  if (hinted && !inside.startsWith("var(") && !HEX_RE.test(inside)) {
    return { hint: hinted[1] ?? "", inside: hinted[2] ?? "" };
  }
  return { hint: "", inside };
};

const classifyColor = (value: string, known: Known): Classified | null => {
  const free = arbitrary(value);
  if (free) {
    if (free.hint && free.hint !== "color") {
      return null;
    }
    const named = wholeVar(free.inside);
    if (named) {
      return fromVar("color", named, known.colors);
    }
    return isColorLiteral(free.inside) ? rawColor(known, free.inside) : null;
  }
  if (NO_COLOR.has(value)) {
    return null;
  }
  const token = `color-${value}`;
  if (known.colors.has(token)) {
    return { kind: "color", status: "system", token, value: token };
  }
  if (PALETTE_RE.test(value) || value === "black" || value === "white") {
    return { kind: "color", status: "default", token, value: token };
  }
  return null;
};

/** A length off the scale, `13px`; null when it is not one. */
const rawLength = (kind: UsageKind, inside: string): Classified | null =>
  LENGTH_RE.test(inside) || NUMBER_RE.test(inside)
    ? { kind, status: "raw", value: inside }
    : null;

const classifyScale = (
  kind: UsageKind,
  value: string,
  prefix: string,
  known: Set<string>,
  defaults: Set<string>
): Classified | null => {
  const free = arbitrary(value);
  if (free) {
    const named = wholeVar(free.inside);
    if (named) {
      return fromVar(kind, named, known);
    }
    if (kind === "shadow") {
      return free.inside === "none"
        ? null
        : { kind, status: "raw", value: free.inside };
    }
    return rawLength(kind, free.inside);
  }
  const token = prefix ? `${prefix}-${value}` : prefix;
  if (known.has(token)) {
    return { kind, status: "system", token, value: token };
  }
  return defaults.has(value)
    ? { kind, status: "default", token, value: token }
    : null;
};

const classifyShadow = (value: string, known: Known): Classified | null => {
  if (value === "") {
    return { kind: "shadow", status: "default", value: "shadow" };
  }
  return value === "none" || value === "inner"
    ? null
    : classifyScale("shadow", value, "shadow", known.shadows, DEFAULT_SHADOWS);
};

const classifyRadius = (value: string, known: Known): Classified | null => {
  if (value === "none" || value === "full") {
    return null;
  }
  if (value === "") {
    return { kind: "radius", status: "default", value: "radius" };
  }
  return classifyScale("radius", value, "radius", known.radii, DEFAULT_RADII);
};

const classifySpacing = (value: string, known: Known): Classified | null => {
  // Every multiple of the base is on the scale: `p-4` is four steps of `--spacing`.
  if (value === "px" || spacingStepOf(`spacing-${value}`) !== null) {
    return value === "0"
      ? null
      : { kind: "spacing", status: "system", value: `spacing ${value}` };
  }
  const free = arbitrary(value);
  if (free) {
    const named = wholeVar(free.inside);
    if (named) {
      return fromVar("spacing", named, known.spacing);
    }
    return isComputed(free.inside) ? null : rawLength("spacing", free.inside);
  }
  const token = `spacing-${value}`;
  return known.spacing.has(token)
    ? { kind: "spacing", status: "system", token, value: token }
    : null;
};

const classifyLayer = (value: string, known: Known): Classified | null => {
  const free = arbitrary(value);
  if (free) {
    return NUMBER_RE.test(free.inside)
      ? { kind: "zIndex", status: "raw", value: free.inside }
      : null;
  }
  if (known.layers.has(value)) {
    return { kind: "zIndex", status: "system", value };
  }
  return DEFAULT_LAYERS.has(value)
    ? { kind: "zIndex", status: "default", value }
    : null;
};

/** What a utility's value is once it is not a colour: by the utility, the first that says. */
const classifyOther = (
  use: string,
  value: string,
  known: Known
): Classified | null => {
  if (use === "text") {
    return classifyScale("fontSize", value, "text", known.sizes, DEFAULT_SIZES);
  }
  if (use === "shadow") {
    return classifyShadow(value, known);
  }
  if (use === "font") {
    return classifyScale(
      "fontWeight",
      value,
      "font-weight",
      known.weights,
      DEFAULT_WEIGHTS
    );
  }
  if (RADIUS_SET.has(use)) {
    return classifyRadius(value, known);
  }
  if (SPACING_SET.has(use)) {
    return classifySpacing(value, known);
  }
  return use === "z" ? classifyLayer(value, known) : null;
};

const classifyClass = (
  use: string,
  value: string,
  known: Known
): Classified | null =>
  (COLOR_SET.has(use) ? classifyColor(value, known) : null) ??
  classifyOther(use, value, known);

/** The tokens of a kind, which a `var()` in a declaration may name. */
const tokensOf = (kind: UsageKind, known: Known): Set<string> =>
  ({
    color: known.colors,
    element: new Set<string>(),
    fontSize: known.sizes,
    fontWeight: known.weights,
    radius: known.radii,
    shadow: known.shadows,
    spacing: known.spacing,
    zIndex: known.layers,
  })[kind];

/** The colours a declared value writes out; a shadow with none is written out as a whole. */
const writtenColors = (
  kind: "color" | "shadow",
  value: string,
  rest: string,
  known: Known,
  named: number
): Classified[] => {
  const out: Classified[] = [];
  FUNCTION_COLOR_RE.lastIndex = 0;
  for (const match of rest.matchAll(FUNCTION_COLOR_RE)) {
    out.push(rawColor(known, match[0]));
  }
  HEX_IN_RE.lastIndex = 0;
  for (const match of rest.matchAll(HEX_IN_RE)) {
    out.push(rawColor(known, match[0]));
  }
  if (kind === "color" && NAMED_COLORS.has(rest.trim().toLowerCase())) {
    out.push(rawColor(known, rest));
  }
  if (
    kind === "shadow" &&
    out.length + named === 0 &&
    value.trim() !== "none"
  ) {
    out.push({
      kind,
      literal: value.trim(),
      status: "raw",
      value: value.trim(),
    });
  }
  return out;
};

/** The lengths or numbers a declared value writes out. */
const writtenValues = (kind: UsageKind, rest: string): Classified[] => {
  if (kind === "spacing" || kind === "fontSize" || kind === "radius") {
    return [...rest.matchAll(LENGTH_IN_RE)]
      .filter((match) => Number.parseFloat(match[0]) !== 0)
      .map((match) => ({
        kind,
        literal: match[0],
        status: "raw" as const,
        value: match[0],
      }));
  }
  return NUMBER_RE.test(rest.trim())
    ? [{ kind, literal: rest.trim(), status: "raw", value: rest.trim() }]
    : [];
};

/** Every var() a declared value refers to, and the literals it writes, for a kind. */
const classifyDeclared = (
  kind: UsageKind,
  value: string,
  known: Known
): Classified[] => {
  const out: Classified[] = [];
  let rest = value;
  for (const match of value.matchAll(VAR_ALL_RE)) {
    const name = match[1] ?? "";
    // `calc(var(--spacing) * 4)` is a step of the scale.
    const token =
      kind === "spacing" && name === "spacing"
        ? ({ kind, status: "system", value: "spacing" } as const)
        : fromVar(kind, name, tokensOf(kind, known));
    if (token) {
      out.push(token);
    }
    rest = rest.replace(match[0], " ");
  }
  return [
    ...out,
    ...(kind === "color" || kind === "shadow"
      ? writtenColors(kind, value, rest, known, out.length)
      : writtenValues(kind, rest)),
  ];
};

/** `background-color` → `backgroundColor`, so stylesheets and style objects read alike. */
const camel = (property: string) =>
  property.replace(DASHED_RE, (_, c: string) => c.toUpperCase());

/** Shorthands whose value may hold a colour: `border: 1px solid #ccc`. */
const COLOR_SHORTHANDS = new Set([
  "border",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "borderTop",
  "outline",
]);

const kindOfProperty = (property: string): UsageKind | null => {
  if (
    STYLE_COLOR.has(property) ||
    COLOR_SHORTHANDS.has(property) ||
    property.endsWith("Color")
  ) {
    return "color";
  }
  if (STYLE_SPACING.has(property)) {
    return "spacing";
  }
  return STYLE_KIND[property] ?? null;
};

export const classify = (
  use: UsageOccurrence,
  known: Known,
  ctx: UsageContext,
  file: string
): Classified[] => {
  if (use.use === "literal") {
    return [rawColor(known, use.value)];
  }
  if (use.use === "element") {
    if (ctx.libraryDirs.some((dir) => file.startsWith(`${dir}/`))) {
      return [];
    }
    const component = (ELEMENT_COMPONENTS[use.value] ?? []).find((name) =>
      ctx.components.includes(name)
    );
    return component
      ? [{ kind: "element", status: "raw", token: component, value: use.value }]
      : [];
  }
  if (use.use.startsWith("style:") || use.use.startsWith("css:")) {
    const property = camel(use.use.slice(use.use.indexOf(":") + 1));
    const kind = kindOfProperty(property);
    if (!kind) {
      return [];
    }
    // A number in a style object is pixels, but a weight or a layer is a number of its own.
    const value =
      use.use.startsWith("style:") &&
      NUMBER_RE.test(use.value) &&
      (kind === "spacing" || kind === "fontSize" || kind === "radius")
        ? `${use.value}px`
        : use.value;
    return classifyDeclared(kind, value, known);
  }
  const one = classifyClass(use.use, use.value, known);
  return one ? [one] : [];
};
