/**
 * The design system's values in the Design Tokens Community Group's format, 2025.10: where they are
 * kept (ADR 0035), beside `design-system.json`, and what Style Dictionary, Tokens Studio and
 * Figma's variables read. Pure.
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
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";
import {
  foreignToken,
  numberCss,
  type ValueHint,
} from "@ultrapaint/contracts/token-naming";
import {
  allTokens,
  nameOfVariable,
  TOKEN_TABLE,
  tokenKindOf,
  tokenPrefix,
} from "@ultrapaint/contracts/token-table";
import {
  type Channel,
  COLOR_SPACES,
  type ColorSpace,
  formatNumber,
  hexOf,
  parseColor,
  parseLength,
  parseNumber,
  parseValue,
  printColor,
} from "@ultrapaint/contracts/token-value";
import type { SourceToken, TokenKind } from "@ultrapaint/contracts/tokens";
import { Predicate } from "effect";

/** The values' file, in the designs directory next to `design-system.json`. */
export const DESIGN_TOKENS_FILE = "design.tokens.json";

const EXTENSION = "dev.ultrapaint";
const FORMAT = "2025.10";

type Rec = Record<string, unknown>;

/**
 * Each kind's group in the file, named as the format's tools name them; the groups are written
 * in the token table's order, `other` last.
 */
const GROUP_NAMES: Record<TokenKind, string> = {
  animation: "animation",
  borderWidth: "border-width",
  breakpoint: "breakpoint",
  color: "color",
  container: "container",
  duration: "duration",
  easing: "easing",
  font: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  leading: "leading",
  other: "other",
  radius: "radius",
  shadow: "shadow",
  spacing: "spacing",
  tracking: "tracking",
};
const GROUP_ORDER: readonly string[] = [
  ...TOKEN_TABLE.map((entry) => GROUP_NAMES[entry.kind]),
  GROUP_NAMES.other,
];

const HEX6_RE = /^#[0-9a-f]{6}$/i;
const BEZIER_RE = /^cubic-bezier\(([^()]*)\)$/i;
const VAR_RE = /^var\(\s*--([\w-]+)\s*\)$/;
const ALIAS_RE = /^\{([^{}]+)\}$/;
const KEY_UNSAFE_RE = /[.{}]/g;
const PLAIN_FAMILY_RE = /^[a-z0-9-]+$/i;

const round = (n: number, places = 6) => Number(n.toFixed(places));
const num = (n: number) => formatNumber(n, 6);

/** What the format holds for a CSS value: its `$type`, left out for an alias, and its `$value`. */
interface Encoded {
  readonly type?: string;
  readonly value: unknown;
}

// Colours.

/** A colour value of the format: its space, channels and alpha as read, with sRGB's hex beside. */
const encodeColor = (css: string): Rec | undefined => {
  const color = parseColor(css);
  if (!color) {
    return undefined;
  }
  // sRGB's channels to four places, as eight bits need; other spaces' to six.
  const places = color.space === "srgb" ? 4 : 6;
  return {
    colorSpace: color.space,
    components: color.channels.map((c) =>
      c === "none" ? c : round(c, places)
    ),
    ...(color.alpha < 1 && { alpha: round(color.alpha, 4) }),
    hex: hexOf({ ...color, alpha: 1 }),
  };
};

const isSpace = (space: unknown): space is ColorSpace =>
  (COLOR_SPACES as readonly unknown[]).includes(space);
const isChannel = (c: unknown): c is Channel =>
  typeof c === "number" || c === "none";

/** The CSS of a colour value of the format, null for one that is not. */
const colorCss = (value: Rec): string | undefined => {
  const { alpha, colorSpace: space, components, hex } = value;
  if (
    !(isSpace(space) && Array.isArray(components)) ||
    components.length !== 3 ||
    !components.every(isChannel)
  ) {
    return undefined;
  }
  const a = typeof alpha === "number" && alpha < 1 ? alpha : undefined;
  const fromHex =
    space === "srgb" && typeof hex === "string" && HEX6_RE.test(hex)
      ? parseColor(hex)
      : null;
  if (fromHex) {
    return hexOf({ ...fromHex, alpha: a ?? 1 });
  }
  const [c0, c1, c2] = components;
  return printColor({
    alpha: a ?? 1,
    channels: [c0 ?? 0, c1 ?? 0, c2 ?? 0],
    kind: "color",
    space,
  });
};

// Everything else.

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

const encodeDimension = (css: string): Encoded | undefined => {
  if (css === "0") {
    return { type: "dimension", value: { unit: "px", value: 0 } };
  }
  const length = parseLength(css);
  return length && (length.unit === "px" || length.unit === "rem")
    ? { type: "dimension", value: { unit: length.unit, value: length.value } }
    : undefined;
};

const encodeDuration = (css: string): Encoded | undefined => {
  const value = parseValue(css);
  return value.kind === "duration"
    ? { type: "duration", value: { unit: value.unit, value: value.value } }
    : undefined;
};

const encodeNumber = (css: string): Encoded | undefined => {
  const n = parseNumber(css);
  return n === null ? undefined : { type: "number", value: n };
};

const encodeFontWeight = (css: string): Encoded | undefined => {
  const n = parseNumber(css);
  if (n !== null) {
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
  const points = m?.[1]?.split(",").map(parseNumber);
  if (!(points?.length === 4 && points.every((p) => p !== null))) {
    return undefined;
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
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
  const ref = refs.get(
    found?.[1] === undefined ? "" : nameOfVariable(found[1])
  );
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
  if (value.length > 0 && value.every(Predicate.isObject)) {
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
  if (!Predicate.isObject(value)) {
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
const tokensOf = (ds: DesignSystem): { token: Token; extra: Rec }[] =>
  allTokens(ds).map((token) => ({
    extra: {
      ...(typeof token.lineHeight === "string" && {
        lineHeight: token.lineHeight,
      }),
      ...(typeof token.source === "string" && { source: token.source }),
    },
    token,
  }));

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
    const group = GROUP_NAMES[kind];
    const base = keyOf(token.name, group, tokenPrefix(kind));
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
export const designTokensDocument = (
  ds: DesignSystem
): Record<string, unknown> => {
  const placed = place(ds);
  const refs = new Map(
    placed.map((p) => [p.token.name, `${p.group}.${p.key}`])
  );
  const doc: Rec = {};
  for (const group of GROUP_ORDER) {
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
  `${JSON.stringify(designTokensDocument(ds), null, 2)}\n`;

// Reading.

/** A token read from a Design Tokens file, in a theme when `theme` is given. */
interface ReadToken {
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

/** The types of the format that say what a value is, as token-naming's hints. */
const HINTS: ReadonlySet<string> = new Set<NonNullable<ValueHint>>([
  "color",
  "cubicBezier",
  "dimension",
  "duration",
  "fontFamily",
  "fontWeight",
  "number",
  "shadow",
]);

const hintOf = (type: string | undefined): ValueHint =>
  type !== undefined && HINTS.has(type) ? (type as ValueHint) : null;

/** A token's name and kind: its own, kept in the extension, or token-naming's from its path. */
type Named =
  | { readonly exact: boolean; readonly kind: TokenKind; readonly name: string }
  | { readonly skipped: string };

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
    if (
      (key.startsWith("$") && key !== "$root") ||
      !Predicate.isObject(child)
    ) {
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
  const ours = Predicate.isObject(all) ? all[EXTENSION] : undefined;
  return Predicate.isObject(ours) ? ours : {};
};

/** Canonical JSON, keys sorted, to tell whether two values are the same. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    Predicate.isObject(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  );

/**
 * The file's tokens by path: a token's type (its own or its group's, else that of the token its
 * alias points at), and its name, the one kept in the extension or token-naming's from its path
 * and type. A composite token has none.
 */
const namesOf = (entries: readonly Entry[]) => {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const target = (ref: string) => byPath.get(ref) ?? byPath.get(`${ref}.$root`);
  const typeOf = (e: Entry, seen = new Set<string>()): string | undefined => {
    if (e.type !== undefined || seen.has(e.path)) {
      return e.type;
    }
    seen.add(e.path);
    const alias: RegExpExecArray | null =
      typeof e.node.$value === "string" ? ALIAS_RE.exec(e.node.$value) : null;
    const to = alias?.[1] === undefined ? undefined : target(alias[1]);
    return to && typeOf(to, seen);
  };
  const isComposite = (e: Entry) => COMPOSITE_TYPES.has(typeOf(e) ?? "");
  const named = new Map<string, Named>();
  for (const e of entries) {
    const { name } = extensionOf(e.node);
    if (typeof name === "string") {
      named.set(e.path, { exact: true, kind: tokenKindOf(name), name });
    } else if (!isComposite(e)) {
      const found = foreignToken(e.segments, hintOf(typeOf(e)));
      named.set(e.path, "name" in found ? { ...found, exact: false } : found);
    }
  }
  return { isComposite, named, target, typeOf };
};

/** One note for the tokens token-naming left out for one reason, by the reason. */
const leftOutNotes = (unnamed: ReadonlyMap<string, readonly string[]>) =>
  [...unnamed].map(
    ([reason, paths]) =>
      `${paths.map((p) => `\`${p}\``).join(", ")}: ${reason}, so ${paths.length === 1 ? "it is" : "they are"} left out.`
  );

/**
 * A Design Tokens file's tokens as CSS values, the default theme's and every other theme's. A
 * file this module wrote reads back exactly: the names are in the extension, and the CSS kept
 * there is used when the structured value still says the same thing (a tool that changed the
 * value wins). Another tool's token is named by token-naming from its path and its type (an
 * alias's the type of the token it points at): `color.blue.500` is `color-blue-500`, a `Corner.sm`
 * dimension `radius-sm`, and a number of a length kind is in pixels. Its aliases are resolved
 * within the file. `notes` says what could not be read or was left out.
 */
export const tokensFromDesignTokens = (
  json: unknown
): {
  readonly notes: readonly string[];
  readonly tokens: readonly ReadToken[];
} => {
  const notes = new Set<string>();
  if (!Predicate.isObject(json)) {
    return {
      notes: [
        "The file is not a Design Tokens document: it is not a JSON object.",
      ],
      tokens: [],
    };
  }
  const entries: Entry[] = [];
  collect(json, [], undefined, entries, notes);
  const { isComposite, named, target, typeOf } = namesOf(entries);
  const nameOf = (e: Entry): string | undefined => {
    const found = named.get(e.path);
    return found && "name" in found ? found.name : undefined;
  };
  const refs = new Map(
    entries.flatMap((e) => {
      const name = nameOf(e);
      return name === undefined ? [] : [[name, e.path] as const];
    })
  );

  /**
   * The CSS a value says, the CSS kept beside it when the two still agree; another tool's number
   * of a length kind in pixels.
   */
  const read = (
    e: Entry,
    value: unknown,
    kept: unknown,
    resolve: Resolve
  ): string | undefined => {
    if (typeof kept === "string") {
      const encoded = encode(tokenKindOf(nameOf(e) ?? ""), kept, refs);
      if (canonical(encoded?.value ?? kept) === canonical(value)) {
        return kept;
      }
    }
    const own = named.get(e.path);
    if (typeof value === "number" && own && "name" in own && !own.exact) {
      return numberCss(own.kind, value);
    }
    return cssOf(value, resolve);
  };

  const resolved = new Map<string, string | undefined>();
  const resolving = new Set<string>();
  const resolverFor =
    (at: string): Resolve =>
    (ref) => {
      const to = target(ref);
      if (!to) {
        notes.add(
          `\`${at}\`: {${ref}} is no token of the file, so it is left out.`
        );
        return;
      }
      if (resolving.has(to.path)) {
        notes.add(
          `\`${at}\`: {${ref}} refers back to itself, so it is left out.`
        );
        return;
      }
      return defaultValue(to);
    };
  const defaultValue = (e: Entry): string | undefined => {
    if (resolved.has(e.path)) {
      return resolved.get(e.path);
    }
    resolving.add(e.path);
    const value = isComposite(e)
      ? undefined
      : read(e, e.node.$value, extensionOf(e.node).css, resolverFor(e.path));
    resolving.delete(e.path);
    resolved.set(e.path, value);
    return value;
  };

  const themeTokens = (e: Entry, name: string): ReadToken[] => {
    const ext = extensionOf(e.node);
    const themes = Predicate.isObject(ext.themes) ? ext.themes : {};
    const themesCss = Predicate.isObject(ext.themesCss) ? ext.themesCss : {};
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
  const taken = new Set<string>();
  /** The paths left out for a reason token-naming gives, by the reason. */
  const unnamed = new Map<string, string[]>();
  for (const e of entries) {
    const found = named.get(e.path);
    if (found === undefined || isComposite(e)) {
      notes.add(
        `\`${e.path}\`: a ${typeOf(e)} value is several properties at once, which no token holds, so it is left out.`
      );
      continue;
    }
    if ("skipped" in found) {
      unnamed.set(found.skipped, [
        ...(unnamed.get(found.skipped) ?? []),
        e.path,
      ]);
      continue;
    }
    const { name } = found;
    if (taken.has(name)) {
      notes.add(
        `\`${e.path}\` is named ${name} as another token is, so it is left out.`
      );
      continue;
    }
    taken.add(name);
    const before = notes.size;
    const value = defaultValue(e);
    if (value === undefined) {
      if (notes.size === before) {
        notes.add(
          `\`${e.path}\`: its value could not be read as CSS, so it is left out.`
        );
      }
      continue;
    }
    tokens.push({ name, value });
    tokens.push(...themeTokens(e, name));
  }
  return { notes: [...notes, ...leftOutNotes(unnamed)], tokens };
};

/**
 * A Design Tokens file's tokens as the design system takes them: one token per name, the other
 * themes' values with it.
 */
export const tokensOfFile = (read: readonly ReadToken[]): SourceToken[] => {
  const byName = new Map<string, SourceToken>();
  for (const t of read) {
    const found = byName.get(t.name);
    if (t.theme === undefined) {
      byName.set(t.name, {
        kind: tokenKindOf(t.name),
        name: t.name,
        own: true,
        value: t.value,
        ...(found?.values && { values: found.values }),
      });
    } else if (found) {
      byName.set(t.name, {
        ...found,
        values: { ...found.values, [t.theme]: t.value },
      });
    }
  }
  return [...byName.values()];
};

/**
 * `design.tokens.json`'s text read: its tokens and what could not be read, or the reason it is no
 * Design Tokens file at all.
 */
export const readDesignTokens = (
  text: string
):
  | { readonly notes: readonly string[]; readonly tokens: SourceToken[] }
  | { readonly problem: string } => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { problem: `${DESIGN_TOKENS_FILE} is not JSON: ${String(error)}` };
  }
  const { notes, tokens } = tokensFromDesignTokens(json);
  return { notes, tokens: tokensOfFile(tokens) };
};
