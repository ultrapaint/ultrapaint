/**
 * A use held against the design system: what kind of value it is (a colour, a spacing, a type
 * size…) and whether it is the design system's own, Tailwind's default, or written out.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  UsageKind,
  UsageStatus,
} from "@ultrapaint/contracts/design-system-setup";
import {
  type ListedToken,
  spacingStepOf,
  tokensByValue,
  tokensOfKind,
  type ValueLookup,
} from "@ultrapaint/contracts/token-table";
import type {
  UsageContext,
  UsageOccurrence,
} from "@ultrapaint/framework-api/node";
import {
  COLOR_SET,
  ELEMENT_COMPONENTS,
  FUNCTION_COLOR_RE,
  isColorLiteral,
  NAMED_COLORS,
  normaliseColor,
  RADIUS_SET,
  SPACING_SET,
} from "./usage-vocabulary.ts";
import {
  arbitraryOf,
  RADIUS_STEPS,
  SHADOW_STEPS,
  TEXT_STEPS,
  WEIGHT_STEPS,
} from "./utilities.ts";

const HEX_IN_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const WHOLE_VAR_RE = /^var\(\s*--([\w-]+)\s*(?:,[^)]*)?\)$/;
const VAR_ALL_RE = /var\(\s*--([\w-]+)/g;
const PALETTE_RE = /^[a-z]+-\d{2,3}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const LENGTH_RE = /^-?\d*\.?\d+(px|rem|em)$/;
const LENGTH_IN_RE = /-?\d*\.?\d+(px|rem|em)\b/g;
const DASHED_RE = /-([a-z])/g;

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
  readonly colors: Set<string>;
  /** The colour tokens that hold a colour, in the design system's order. */
  readonly colorsByValue: ValueLookup<ListedToken>;
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
  const colorTokens = tokensOfKind(ds, "color").filter((t) => keep(t.name));
  return {
    colors: new Set(colorTokens.map((t) => t.name)),
    colorsByValue: tokensByValue(colorTokens),
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
  // The first colour token that holds it, in whatever space either is written.
  const [token] = known.colorsByValue("color", literal);
  return {
    kind: "color",
    literal: literal.trim(),
    status: "raw",
    value: normaliseColor(literal),
    ...(token !== undefined && { token: token.name }),
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

const classifyColor = (value: string, known: Known): Classified | null => {
  const free = arbitraryOf(value);
  if (free) {
    if (free.hint !== undefined && free.hint !== "color") {
      return null;
    }
    const named = wholeVar(free.css);
    if (named) {
      return fromVar("color", named, known.colors);
    }
    return isColorLiteral(free.css) ? rawColor(known, free.css) : null;
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
  /** Tailwind's own steps of the scale, which a design system has unless it says otherwise. */
  defaults: { readonly has: (step: string) => boolean }
): Classified | null => {
  const free = arbitraryOf(value);
  if (free) {
    const named = wholeVar(free.css);
    if (named) {
      return fromVar(kind, named, known);
    }
    if (kind === "shadow") {
      return free.css === "none"
        ? null
        : { kind, status: "raw", value: free.css };
    }
    return rawLength(kind, free.css);
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
    : classifyScale("shadow", value, "shadow", known.shadows, SHADOW_STEPS);
};

const classifyRadius = (value: string, known: Known): Classified | null => {
  if (value === "none" || value === "full") {
    return null;
  }
  if (value === "") {
    return { kind: "radius", status: "default", value: "radius" };
  }
  return classifyScale("radius", value, "radius", known.radii, RADIUS_STEPS);
};

const classifySpacing = (value: string, known: Known): Classified | null => {
  // Every multiple of the base is on the scale: `p-4` is four steps of `--spacing`.
  if (value === "px" || spacingStepOf(`spacing-${value}`) !== null) {
    return value === "0"
      ? null
      : { kind: "spacing", status: "system", value: `spacing ${value}` };
  }
  const free = arbitraryOf(value);
  if (free) {
    const named = wholeVar(free.css);
    if (named) {
      return fromVar("spacing", named, known.spacing);
    }
    return isComputed(free.css) ? null : rawLength("spacing", free.css);
  }
  const token = `spacing-${value}`;
  return known.spacing.has(token)
    ? { kind: "spacing", status: "system", token, value: token }
    : null;
};

const classifyLayer = (value: string, known: Known): Classified | null => {
  const free = arbitraryOf(value);
  if (free) {
    return NUMBER_RE.test(free.css)
      ? { kind: "zIndex", status: "raw", value: free.css }
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
    return classifyScale("fontSize", value, "text", known.sizes, TEXT_STEPS);
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
      WEIGHT_STEPS
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
