/**
 * The design system in the Design Tokens Community Group's format, 2025.10 (ADR 0028): the export
 * that Style Dictionary, Tokens Studio and Figma's variables read. Pure.
 *
 * Tokens are grouped by kind (`color`, `spacing`, `font-size`…) under their names without the
 * kind's prefix, so `color-primary-foreground` is `color.primary-foreground` and `--spacing` is
 * `spacing.$root`. Every token carries its full name under `$extensions["dev.ultrapaint"].name`,
 * so reading the file back is exact. Colours, dimensions, durations, font families and weights,
 * cubic Béziers and unitless line heights are written as the format's structured values, and a
 * `var()` of another token as an alias of it. When the structure does not say the CSS exactly
 * (`#FFF`, `oklch(62.3% …)`), the CSS is kept under the extension's `css` as well. A value the
 * format has no type for (a shadow, an animation, a `calc()`) is written as its CSS, with no
 * `$type`. The other themes' values are under the extension's `themes`, encoded as `$value` is,
 * and their CSS under `themesCss` when the encoding does not say it exactly.
 */
import {
  type DesignSystem,
  mapTokens,
  type Token,
} from "@ultrapaint/contracts/design-system";
import { type TokenKind, tokenKindOf } from "@ultrapaint/contracts/tokens";
import { parseColor } from "./token-values.ts";

/** The export, in the designs directory next to `design-system.json`. */
export const DESIGN_TOKENS_FILE = "design.tokens.json";

const EXTENSION = "dev.ultrapaint";
const FORMAT = "2025.10";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Each kind's group in the file and the prefix its names start with, in the order written. */
const KIND_GROUPS: readonly (readonly [TokenKind, string, string])[] = [
  ["color", "color", "color-"],
  ["spacing", "spacing", "spacing-"],
  ["fontSize", "font-size", "text-"],
  ["fontWeight", "font-weight", "font-weight-"],
  ["font", "font-family", "font-"],
  ["leading", "leading", "leading-"],
  ["tracking", "tracking", "tracking-"],
  ["radius", "radius", "radius-"],
  ["shadow", "shadow", "shadow-"],
  ["borderWidth", "border-width", "border-width-"],
  ["breakpoint", "breakpoint", "breakpoint-"],
  ["container", "container", "container-"],
  ["easing", "easing", "ease-"],
  ["duration", "duration", "duration-"],
  ["animation", "animation", "animate-"],
  ["other", "other", ""],
];

const LENGTH_RE = /^(-?\d*\.?\d+)(px|rem)$/;
const DURATION_RE = /^(-?\d*\.?\d+)(ms|s)$/;
const NUMBER_RE = /^-?\d*\.?\d+$/;
const HEX_RE = /^#[0-9a-f]{3,8}$/i;
const HEX6_RE = /^#[0-9a-f]{6}$/i;
const COLOR_FN_RE =
  /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/i;
const COMPONENT_RE = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)(%|deg)?$/i;
const LIST_RE = /[\s,]+/;
const BEZIER_RE = /^cubic-bezier\(([^()]*)\)$/i;
const VAR_RE = /^var\(\s*--([\w-]+)\s*\)$/;
const ALIAS_RE = /^\{([^{}]+)\}$/;
const KEY_UNSAFE_RE = /[.{}]/g;
const PLAIN_FAMILY_RE = /^[a-z0-9-]+$/i;
const SLUG_RE = /[^a-z0-9_-]+/g;
const GROUP_NORMAL_RE = /[-_\s]/g;
const TRAILING_DASH_RE = /-$/;

const round = (n: number, places = 6) => Number(n.toFixed(places));
const num = (n: number) => String(round(n));

/** What the format holds for a CSS value: its `$type`, left out for an alias, and its `$value`. */
interface Encoded {
  readonly type?: string;
  readonly value: unknown;
}

// Colours.

type Component = number | "none";

/** What 100% is for each component of a CSS colour function; NaN where a percentage is not allowed. */
const PERCENT_SCALE: Record<string, readonly [number, number, number]> = {
  color: [1, 1, 1],
  hsl: [Number.NaN, 100, 100],
  hwb: [Number.NaN, 100, 100],
  lab: [100, 125, 125],
  lch: [100, 150, Number.NaN],
  oklab: [1, 0.4, 0.4],
  oklch: [1, 0.4, Number.NaN],
  rgb: [1, 1, 1],
};
/** Which component is a hue, the one that may be written in degrees. */
const HUE_INDEX: Record<string, number> = { hsl: 0, hwb: 0, lch: 2, oklch: 2 };
const FUNCTION_SPACES: Record<string, string> = {
  hsl: "hsl",
  hsla: "hsl",
  hwb: "hwb",
  lab: "lab",
  lch: "lch",
  oklab: "oklab",
  oklch: "oklch",
  rgb: "srgb",
  rgba: "srgb",
};
/** The legacy names of colour functions, which take the same components. */
const LEGACY_NAMES: Record<string, string> = { hsla: "hsl", rgba: "rgb" };
/** The spaces `color()` names that the format has, `xyz` being `xyz-d65`. */
const PREDEFINED_SPACES: Record<string, string> = {
  "a98-rgb": "a98-rgb",
  "display-p3": "display-p3",
  "prophoto-rgb": "prophoto-rgb",
  rec2020: "rec2020",
  srgb: "srgb",
  "srgb-linear": "srgb-linear",
  xyz: "xyz-d65",
  "xyz-d50": "xyz-d50",
  "xyz-d65": "xyz-d65",
};
const FONT_WEIGHT_KEYWORDS = new Set([
  "thin",
  "hairline",
  "extra-light",
  "ultra-light",
  "light",
  "normal",
  "regular",
  "book",
  "medium",
  "semi-bold",
  "demi-bold",
  "bold",
  "extra-bold",
  "ultra-bold",
  "black",
  "heavy",
  "extra-black",
  "ultra-black",
]);

const byte = (n: number) =>
  Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, "0");

const hexOf = (rgb: readonly number[]) =>
  `#${rgb
    .slice(0, 3)
    .map((c) => byte(c))
    .join("")}`;

/** One component of a colour function, in the range the format gives its colour space. */
const component = (part: string, fn: string, i: number): Component | null => {
  if (part.toLowerCase() === "none") {
    return "none";
  }
  const m: RegExpExecArray | null = COMPONENT_RE.exec(part);
  if (!m?.[1]) {
    return null;
  }
  const n = Number(m[1]);
  if (m[2] === "%") {
    const scale = PERCENT_SCALE[fn]?.[i] ?? Number.NaN;
    return Number.isNaN(scale) ? null : round((n / 100) * scale);
  }
  if (m[2]) {
    return HUE_INDEX[fn] === i ? n : null;
  }
  return fn === "rgb" ? round(n / 255, 4) : n;
};

const alphaOf = (part: string | undefined): number | null => {
  if (part === undefined) {
    return 1;
  }
  const m: RegExpExecArray | null = COMPONENT_RE.exec(part.trim());
  if (!m?.[1] || m[2] === "deg") {
    return null;
  }
  const n = Number(m[1]);
  return m[2] === "%" ? n / 100 : n;
};

/** A colour value of the format, from hex or one of the three names `parseColor` knows. */
const encodeSrgb = (css: string): Rec | undefined => {
  if (!(HEX_RE.test(css) || ["white", "black", "transparent"].includes(css))) {
    return undefined;
  }
  const rgba = parseColor(css);
  if (!rgba) {
    return undefined;
  }
  const alpha = round(rgba[3], 4);
  return {
    colorSpace: "srgb",
    components: rgba.slice(0, 3).map((c) => round(c, 4)),
    ...(alpha < 1 && { alpha }),
    hex: hexOf(rgba),
  };
};

const encodeColor = (css: string): Rec | undefined => {
  const fn: RegExpExecArray | null = COLOR_FN_RE.exec(css);
  if (!(fn?.[1] && fn[2] !== undefined)) {
    return encodeSrgb(css.toLowerCase());
  }
  const name = fn[1].toLowerCase();
  const [main = "", alphaPart, extra] = fn[2].split("/");
  const parts = main.trim().split(LIST_RE).filter(Boolean);
  const space =
    name === "color"
      ? PREDEFINED_SPACES[parts.shift()?.toLowerCase() ?? ""]
      : FUNCTION_SPACES[name];
  // The legacy `rgba(0, 0, 0, 0.5)` gives the alpha as a fourth component.
  const legacyAlpha =
    alphaPart === undefined && parts.length === 4 ? parts.pop() : alphaPart;
  const components = parts.map((p, i) =>
    component(p, LEGACY_NAMES[name] ?? name, i)
  );
  const alpha = alphaOf(legacyAlpha);
  if (
    space === undefined ||
    extra !== undefined ||
    components.length !== 3 ||
    components.some((c) => c === null) ||
    alpha === null
  ) {
    return undefined;
  }
  const rgba = space === "srgb" ? null : parseColor(css);
  const hex =
    space === "srgb" && components.every((c) => typeof c === "number")
      ? hexOf(components as number[])
      : rgba && hexOf(rgba);
  return {
    colorSpace: space,
    components,
    ...(alpha < 1 && { alpha: round(alpha, 4) }),
    ...(hex && { hex }),
  };
};

const componentText = (c: unknown, f: (n: number) => string) =>
  typeof c === "number" ? f(c) : "none";

/** The CSS of a colour value of the format, null for one that is not. */
const colorCss = (value: Rec): string | undefined => {
  const { alpha, colorSpace: space, components, hex } = value;
  if (
    typeof space !== "string" ||
    !Array.isArray(components) ||
    components.length !== 3 ||
    !components.every((c) => typeof c === "number" || c === "none")
  ) {
    return undefined;
  }
  const a = typeof alpha === "number" && alpha < 1 ? alpha : undefined;
  if (space === "srgb" && typeof hex === "string" && HEX6_RE.test(hex)) {
    return `${hex.toLowerCase()}${a === undefined ? "" : byte(a)}`;
  }
  const slash = a === undefined ? "" : ` / ${num(a)}`;
  const parts = (f: (n: number, i: number) => string) =>
    components.map((c, i) => componentText(c, (n) => f(n, i))).join(" ");
  switch (space) {
    case "srgb":
      return `rgb(${parts((n) => String(Math.round(n * 255)))}${slash})`;
    case "hsl":
    case "hwb":
      return `${space}(${parts((n, i) => (i === 0 ? num(n) : `${num(n)}%`))}${slash})`;
    case "lab":
    case "lch":
    case "oklab":
    case "oklch":
      return `${space}(${parts(num)}${slash})`;
    default:
      return `color(${space} ${parts(num)}${slash})`;
  }
};

// Everything else.

const encodeDimension = (css: string): Encoded | undefined => {
  if (css === "0") {
    return { type: "dimension", value: { unit: "px", value: 0 } };
  }
  const m: RegExpExecArray | null = LENGTH_RE.exec(css);
  return m?.[1]
    ? { type: "dimension", value: { unit: m[2], value: Number(m[1]) } }
    : undefined;
};

const encodeDuration = (css: string): Encoded | undefined => {
  const m: RegExpExecArray | null = DURATION_RE.exec(css);
  return m?.[1]
    ? { type: "duration", value: { unit: m[2], value: Number(m[1]) } }
    : undefined;
};

const encodeNumber = (css: string): Encoded | undefined =>
  NUMBER_RE.test(css) ? { type: "number", value: Number(css) } : undefined;

const encodeFontWeight = (css: string): Encoded | undefined => {
  if (NUMBER_RE.test(css)) {
    const n = Number(css);
    return n >= 1 && n <= 1000 ? { type: "fontWeight", value: n } : undefined;
  }
  return FONT_WEIGHT_KEYWORDS.has(css)
    ? { type: "fontWeight", value: css }
    : undefined;
};

/** The names of a CSS font list, unquoted; null when it holds anything but names. */
const fontFamilies = (css: string): string[] | null => {
  const names: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of css) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      names.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  names.push(current.trim());
  return quote || names.some((n) => n === "" || n.includes("(")) ? null : names;
};

const encodeFontFamily = (css: string): Encoded | undefined => {
  const names = fontFamilies(css);
  if (!names) {
    return undefined;
  }
  return { type: "fontFamily", value: names.length === 1 ? names[0] : names };
};

const encodeCubicBezier = (css: string): Encoded | undefined => {
  const m: RegExpExecArray | null = BEZIER_RE.exec(css);
  const points = m?.[1]?.split(",").map((p) => p.trim());
  if (!(points?.length === 4 && points.every((p) => NUMBER_RE.test(p)))) {
    return undefined;
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points.map(Number);
  const inRange = (x: number) => x >= 0 && x <= 1;
  return inRange(x1) && inRange(x2)
    ? { type: "cubicBezier", value: [x1, y1, x2, y2] }
    : undefined;
};

const ENCODERS: Partial<
  Record<TokenKind, (css: string) => Encoded | undefined>
> = {
  borderWidth: encodeDimension,
  breakpoint: encodeDimension,
  color: (css) => {
    const value = encodeColor(css);
    return value && { type: "color", value };
  },
  container: encodeDimension,
  duration: encodeDuration,
  easing: encodeCubicBezier,
  font: encodeFontFamily,
  fontSize: encodeDimension,
  fontWeight: encodeFontWeight,
  leading: (css) => encodeNumber(css) ?? encodeDimension(css),
  radius: encodeDimension,
  spacing: encodeDimension,
  tracking: encodeDimension,
};

/**
 * What the format holds for a token's CSS: an alias for a `var()` of a token of the file, the
 * structured value of its kind, or nothing when the format has no type for it.
 */
const encode = (
  kind: TokenKind,
  css: string,
  refs: ReadonlyMap<string, string>
): Encoded | undefined => {
  const found: RegExpExecArray | null = VAR_RE.exec(css);
  const ref = refs.get(found?.[1] ?? "");
  if (ref !== undefined) {
    return { value: `{${ref}}` };
  }
  return ENCODERS[kind]?.(css);
};

const quoteFamily = (name: string) =>
  PLAIN_FAMILY_RE.test(name) ? name : `"${name}"`;

type Resolve = (ref: string) => string | undefined;

const shadowCss = (value: Rec, resolve: Resolve): string | undefined => {
  const parts = [
    value.offsetX,
    value.offsetY,
    value.blur,
    value.spread ?? 0,
    value.color,
  ].map((p) => cssOf(p, resolve));
  if (parts.some((p) => p === undefined)) {
    return undefined;
  }
  return `${value.inset === true ? "inset " : ""}${parts.join(" ")}`;
};

const listCss = (
  value: readonly unknown[],
  resolve: Resolve
): string | undefined => {
  if (value.length === 4 && value.every((v) => typeof v === "number")) {
    return `cubic-bezier(${value.map(num).join(", ")})`;
  }
  if (value.length > 0 && value.every((v) => typeof v === "string")) {
    return value.map(quoteFamily).join(", ");
  }
  if (value.length > 0 && value.every(isRec)) {
    const shadows = value.map((v) => shadowCss(v, resolve));
    return shadows.every((s) => s !== undefined)
      ? shadows.join(", ")
      : undefined;
  }
  return undefined;
};

/** The path a JSON pointer to a token's `$value` names: `#/color/blue/$value` is `color.blue`. */
const pointerPath = (pointer: string): string | undefined => {
  if (!pointer.startsWith("#/")) {
    return undefined;
  }
  const segments = pointer
    .slice(2)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.at(-1) === "$value") {
    segments.pop();
  }
  return segments.some((s) => s.startsWith("$") && s !== "$root")
    ? undefined
    : segments.join(".");
};

/**
 * The CSS of a value of the format, told by its shape: an alias is resolved, a colour written in
 * its colour space's function, a dimension or duration as a number and its unit, a font list
 * quoted where it needs to be. Undefined for what has no single CSS value.
 */
const cssOf = (value: unknown, resolve: Resolve): string | undefined => {
  if (typeof value === "string") {
    const alias: RegExpExecArray | null = ALIAS_RE.exec(value);
    const ref = alias?.[1];
    return ref === undefined ? value : resolve(ref);
  }
  if (typeof value === "number") {
    return num(value);
  }
  if (Array.isArray(value)) {
    return listCss(value, resolve);
  }
  if (!isRec(value)) {
    return undefined;
  }
  if (typeof value.$ref === "string") {
    const path = pointerPath(value.$ref);
    return path === undefined ? undefined : resolve(path);
  }
  if ("colorSpace" in value) {
    return colorCss(value);
  }
  if (typeof value.value === "number" && typeof value.unit === "string") {
    return `${num(value.value)}${value.unit}`;
  }
  if ("offsetX" in value) {
    return shadowCss(value, resolve);
  }
  return undefined;
};

const noResolve: Resolve = () => undefined;

/** Whether the structured value says the CSS exactly, so the CSS need not be kept as well. */
const says = (encoded: Encoded | undefined, css: string) =>
  encoded !== undefined && cssOf(encoded.value, noResolve) === css;

// Writing.

interface Placed {
  readonly extra: Rec;
  readonly group: string;
  readonly key: string;
  readonly kind: TokenKind;
  readonly token: Token;
}

/** Every token of the design system once, `--spacing` first, with any fields beyond a token's. */
const tokensOf = (ds: DesignSystem): { token: Token; extra: Rec }[] => {
  const all: { token: Token; extra: Rec }[] = [
    { extra: {}, token: { name: "spacing", value: ds.spacing.base } },
  ];
  mapTokens(ds, (token) => {
    const { lineHeight, source } = token as Rec;
    all.push({
      extra: {
        ...(typeof lineHeight === "string" && { lineHeight }),
        ...(typeof source === "string" && { source }),
      },
      token,
    });
    return token;
  });
  const seen = new Set<string>();
  return all.filter(({ token }) => {
    const fresh = !seen.has(token.name);
    seen.add(token.name);
    return fresh;
  });
};

/** A token's key in its group: its name without the kind's prefix, `$root` for the group's own. */
const keyOf = (name: string, group: string, prefix: string) => {
  if (name === group) {
    return "$root";
  }
  const bare =
    prefix && name.startsWith(prefix) && name.length > prefix.length
      ? name.slice(prefix.length)
      : name;
  return bare.replace(KEY_UNSAFE_RE, "_");
};

const place = (ds: DesignSystem): Placed[] => {
  const taken = new Set<string>();
  return tokensOf(ds).map(({ extra, token }) => {
    const kind = tokenKindOf(token.name);
    const found = KIND_GROUPS.find(([k]) => k === kind);
    const group = found?.[1] ?? "other";
    const prefix = found?.[2] ?? "";
    const base = keyOf(token.name, group, prefix);
    let key = base;
    for (let n = 2; taken.has(`${group}.${key}`); n += 1) {
      key = `${base}-${n}`;
    }
    taken.add(`${group}.${key}`);
    return { extra, group, key, kind, token };
  });
};

const themeOrder = (
  ds: DesignSystem,
  values: Readonly<Record<string, string>>
) => {
  const order = ds.themes ?? [];
  const rank = (t: string) => {
    const i = order.indexOf(t);
    return i === -1 ? order.length : i;
  };
  return Object.keys(values).sort((a, b) => rank(a) - rank(b));
};

const tokenJson = (
  ds: DesignSystem,
  { extra, kind, token }: Placed,
  refs: ReadonlyMap<string, string>
): Rec => {
  const encoded = encode(kind, token.value, refs);
  const themes: Rec = {};
  const themesCss: Rec = {};
  for (const theme of themeOrder(ds, token.values ?? {})) {
    const css = token.values?.[theme] ?? "";
    const value = encode(kind, css, refs);
    themes[theme] = value?.value ?? css;
    if (value && !says(value, css)) {
      themesCss[theme] = css;
    }
  }
  const ext: Rec = {
    name: token.name,
    ...(!says(encoded, token.value) && { css: token.value }),
    ...(Object.keys(themes).length > 0 && { themes }),
    ...(Object.keys(themesCss).length > 0 && { themesCss }),
    ...extra,
  };
  return {
    ...(encoded?.type !== undefined && { $type: encoded.type }),
    $value: encoded?.value ?? token.value,
    ...(token.description !== undefined && {
      $description: token.description,
    }),
    $extensions: { [EXTENSION]: ext },
  };
};

/**
 * The design system as a Design Tokens document (2025.10): a group for each kind of token, in a
 * fixed order, each token keeping the order the design system lists it in.
 */
export const designTokensOf = (ds: DesignSystem): Record<string, unknown> => {
  const placed = place(ds);
  const refs = new Map(
    placed.map((p) => [p.token.name, `${p.group}.${p.key}`])
  );
  const doc: Rec = {};
  for (const [, group] of KIND_GROUPS) {
    const tokens = placed.filter((p) => p.group === group);
    if (tokens.length > 0) {
      doc[group] = Object.fromEntries(
        tokens.map((p) => [p.key, tokenJson(ds, p, refs)])
      );
    }
  }
  doc.$extensions = {
    [EXTENSION]: {
      format: FORMAT,
      ...(ds.themes && ds.themes.length > 0 && { themes: [...ds.themes] }),
    },
  };
  return doc;
};

/** `design.tokens.json` as it is written: two-space JSON with a trailing newline. */
export const serialiseDesignTokens = (ds: DesignSystem): string =>
  `${JSON.stringify(designTokensOf(ds), null, 2)}\n`;

// Reading.

/** A token read from a Design Tokens file, in a theme when `theme` is given. */
export interface ReadToken {
  readonly name: string;
  readonly theme?: string;
  readonly value: string;
}

interface Entry {
  readonly node: Rec;
  readonly path: string;
  /** The path without `$root`. */
  readonly segments: readonly string[];
  readonly type: string | undefined;
}

/** Types whose values are several CSS properties at once, which no token holds. */
const COMPOSITE_TYPES = new Set([
  "border",
  "gradient",
  "strokeStyle",
  "transition",
  "typography",
]);

const groupKey = (name: string) =>
  name.toLowerCase().replace(GROUP_NORMAL_RE, "");

/** The prefix a token's name takes from the group it is in, by the names tools give groups. */
const GROUP_PREFIXES = new Map<string, string>(
  (
    [
      ["color-", ["color", "colors", "colour", "colours"]],
      ["spacing-", ["spacing", "space", "spacings"]],
      ["text-", ["fontsize", "fontsizes", "text"]],
      ["font-weight-", ["fontweight", "fontweights"]],
      ["font-", ["fontfamily", "fontfamilies", "font", "fonts"]],
      ["leading-", ["leading", "lineheight", "lineheights"]],
      ["tracking-", ["tracking", "letterspacing"]],
      ["radius-", ["radius", "radii", "borderradius"]],
      ["shadow-", ["shadow", "shadows", "boxshadow"]],
      ["border-width-", ["borderwidth", "borderwidths"]],
      ["breakpoint-", ["breakpoint", "breakpoints", "screens"]],
      ["container-", ["container", "containers"]],
      ["ease-", ["easing", "easings", "ease"]],
      ["duration-", ["duration", "durations"]],
      ["animate-", ["animation", "animations", "animate"]],
      ["", ["other"]],
    ] as const
  ).flatMap(([prefix, names]) => names.map((n) => [n, prefix] as const))
);

/** The prefix a token's name takes from its `$type` when its group says nothing. */
const TYPE_PREFIXES: Record<string, string> = {
  color: "color-",
  cubicBezier: "ease-",
  duration: "duration-",
  fontFamily: "font-",
  fontWeight: "font-weight-",
  shadow: "shadow-",
};

const slug = (s: string) => s.trim().toLowerCase().replace(SLUG_RE, "-");

/** A name for a token of another tool's file: the kind's prefix and its path joined with `-`. */
const nameFromPath = (
  segments: readonly string[],
  type: string | undefined
) => {
  const [top = "", ...rest] = segments;
  const prefix = GROUP_PREFIXES.get(groupKey(top));
  if (prefix === undefined) {
    return `${TYPE_PREFIXES[type ?? ""] ?? ""}${segments.map(slug).join("-")}`;
  }
  if (rest.length === 0) {
    return prefix.replace(TRAILING_DASH_RE, "") || slug(top);
  }
  return `${prefix}${rest.map(slug).join("-")}`;
};

const collect = (
  node: Rec,
  segments: readonly string[],
  type: string | undefined,
  out: Entry[],
  notes: Set<string>
) => {
  const groupType = typeof node.$type === "string" ? node.$type : type;
  if ("$extends" in node) {
    notes.add(
      `\`${segments.join(".") || "(root)"}\` extends another group with $extends, which is not followed: only the tokens it lists itself are read.`
    );
  }
  for (const [key, child] of Object.entries(node)) {
    if ((key.startsWith("$") && key !== "$root") || !isRec(child)) {
      continue;
    }
    const path = [...segments, key];
    if ("$value" in child) {
      out.push({
        node: child,
        path: path.join("."),
        segments: path.filter((s) => s !== "$root"),
        type: typeof child.$type === "string" ? child.$type : groupType,
      });
    } else {
      collect(child, path, groupType, out, notes);
    }
  }
};

const extensionOf = (node: Rec): Rec => {
  const all = node.$extensions;
  const ours = isRec(all) ? all[EXTENSION] : undefined;
  return isRec(ours) ? ours : {};
};

/** Canonical JSON, keys sorted, to tell whether two values are the same. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    isRec(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  );

/**
 * A Design Tokens file's tokens as CSS values, the default theme's and every other theme's. A
 * file this module wrote reads back exactly: the names are in the extension, and the CSS kept
 * there is used when the structured value still says the same thing (a tool that changed the
 * value wins). Another tool's file is read by its paths (`color.blue.500` is `color-blue-500`),
 * its aliases resolved within the file. `notes` says what could not be read.
 */
export const tokensFromDesignTokens = (
  json: unknown
): {
  readonly notes: readonly string[];
  readonly tokens: readonly ReadToken[];
} => {
  const notes = new Set<string>();
  if (!isRec(json)) {
    return {
      notes: [
        "The file is not a Design Tokens document: it is not a JSON object.",
      ],
      tokens: [],
    };
  }
  const entries: Entry[] = [];
  collect(json, [], undefined, entries, notes);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const nameOf = (e: Entry) => {
    const { name } = extensionOf(e.node);
    return typeof name === "string" ? name : nameFromPath(e.segments, e.type);
  };
  const refs = new Map(entries.map((e) => [nameOf(e), e.path]));

  /** The CSS a value says, the CSS kept beside it when the two still agree. */
  const read = (
    e: Entry,
    value: unknown,
    kept: unknown,
    resolve: Resolve
  ): string | undefined => {
    if (typeof kept === "string") {
      const encoded = encode(tokenKindOf(nameOf(e)), kept, refs);
      if (canonical(encoded?.value ?? kept) === canonical(value)) {
        return kept;
      }
    }
    return cssOf(value, resolve);
  };

  const resolved = new Map<string, string | undefined>();
  const resolving = new Set<string>();
  const resolverFor =
    (at: string): Resolve =>
    (ref) => {
      const target = byPath.get(ref) ?? byPath.get(`${ref}.$root`);
      if (!target) {
        notes.add(
          `\`${at}\`: {${ref}} is no token of the file, so it is left out.`
        );
        return;
      }
      if (resolving.has(target.path)) {
        notes.add(
          `\`${at}\`: {${ref}} refers back to itself, so it is left out.`
        );
        return;
      }
      return defaultValue(target);
    };
  const defaultValue = (e: Entry): string | undefined => {
    if (resolved.has(e.path)) {
      return resolved.get(e.path);
    }
    resolving.add(e.path);
    const value = COMPOSITE_TYPES.has(e.type ?? "")
      ? undefined
      : read(e, e.node.$value, extensionOf(e.node).css, resolverFor(e.path));
    resolving.delete(e.path);
    resolved.set(e.path, value);
    return value;
  };

  const themeTokens = (e: Entry, name: string): ReadToken[] => {
    const ext = extensionOf(e.node);
    const themes = isRec(ext.themes) ? ext.themes : {};
    const themesCss = isRec(ext.themesCss) ? ext.themesCss : {};
    const out: ReadToken[] = [];
    for (const [theme, value] of Object.entries(themes)) {
      const css = read(e, value, themesCss[theme], resolverFor(e.path));
      if (css === undefined) {
        notes.add(
          `\`${e.path}\`: its value in the ${theme} theme could not be read as CSS, so it is left out.`
        );
      } else {
        out.push({ name, theme, value: css });
      }
    }
    return out;
  };

  const tokens: ReadToken[] = [];
  const named = new Set<string>();
  const unknownKinds: string[] = [];
  for (const e of entries) {
    const name = nameOf(e);
    if (named.has(name)) {
      notes.add(
        `\`${e.path}\` is named ${name} as another token is, so it is left out.`
      );
      continue;
    }
    named.add(name);
    const before = notes.size;
    const value = defaultValue(e);
    if (value === undefined) {
      if (notes.size === before) {
        notes.add(
          COMPOSITE_TYPES.has(e.type ?? "")
            ? `\`${e.path}\`: a ${e.type} value is several properties at once, which no token holds, so it is left out.`
            : `\`${e.path}\`: its value could not be read as CSS, so it is left out.`
        );
      }
      continue;
    }
    tokens.push({ name, value });
    if (
      typeof extensionOf(e.node).name !== "string" &&
      tokenKindOf(name) === "other"
    ) {
      unknownKinds.push(name);
    }
    tokens.push(...themeTokens(e, name));
  }

  if (unknownKinds.length > 0) {
    notes.add(
      `These are in no group or of no type that says what kind of token they are, so they are named after their paths: ${unknownKinds.join(", ")}.`
    );
  }
  return { notes: [...notes], tokens };
};
