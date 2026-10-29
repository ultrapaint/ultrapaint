/**
 * The front matter a design system comes to (ADR 0027, 0028): its colours, radii, spacing and
 * text styles, with its values in the default theme, written as the format holds them. Other
 * themes stay in the design system; the body says how they differ.
 */
import type {
  DesignSystem,
  TextStyle,
  Token,
} from "@ultrapaint/contracts/design-system";
import type { Padding } from "@ultrapaint/contracts/document";
import { ROOT_SLOT } from "@ultrapaint/contracts/spec-names";
import type { ComponentSpec, SpecStyle } from "@ultrapaint/contracts/specs";
import {
  formatNumber,
  isColor,
  resolveCss,
} from "@ultrapaint/contracts/token-value";
import {
  isToken,
  tokenName,
  tokenValues,
} from "@ultrapaint/design-document/tokens";
import type { TokenGroups, Typography } from "./format.ts";
import { documentPathOf, tokenKeyOf } from "./tokens.ts";
import { familyOf, isDimension, isPlainNumber } from "./values.ts";

const DASHES_RE = /^--/;

/** The font a text style without one is set in: Tailwind's, on the body. */
const BODY_FONT = "font-sans";

/** A bare line height below this is a multiple of the font size, as the renderer reads it. */
const MAX_LINE_HEIGHT_FACTOR = 4;

export interface Mirror {
  readonly groups: TokenGroups;
  /** What was left out because the format cannot hold it, a line each. */
  readonly notes: readonly string[];
}

const textStyleKey = (style: TextStyle) => tokenKeyOf(style.name);

/**
 * The tokens named `<prefix>-<key>`, by key, with the values `accept` takes once resolved;
 * what it does not take is said in `notes`.
 */
const groupOf = <A>(
  tokens: readonly Token[],
  prefix: string,
  resolve: (name: string, value: string) => string | null,
  accept: (value: string) => A | null,
  wanted: string,
  notes: string[]
): Record<string, A> => {
  const out: Record<string, A> = {};
  for (const token of tokens) {
    if (!token.name.startsWith(prefix)) {
      continue;
    }
    const resolved = resolve(token.name, token.value);
    const value = resolved === null ? null : accept(resolved);
    if (value !== null) {
      out[token.name.slice(prefix.length)] = value;
    } else if (resolved !== null) {
      notes.push(`${token.name}: ${resolved} is not ${wanted}.`);
    }
  }
  return out;
};

/** A variable of the code (`--radius`) as the design system's token of its name. */
const variableIn =
  (values: ReadonlyMap<string, string>) =>
  (variable: string): string | undefined =>
    values.get(variable.replace(DASHES_RE, ""));

const LENGTH = "a length in px, em or rem";
const lengthOf = (value: string) => (isDimension(value) ? value : null);
const spacingOf = (value: string): number | string | null => {
  if (isDimension(value)) {
    return value;
  }
  return isPlainNumber(value) ? Number(value) : null;
};

/**
 * The front matter's mirrored groups for a design system whose values are the code's (the
 * service merges them in on read).
 */
export const mirrorOf = (
  ds: DesignSystem,
  /**
   * Component tokens by key, each property a token as pages name it (`$color-primary`), a value,
   * or a reference already (`{colors.primary}`); none when the components are not known yet.
   */
  components: Readonly<Record<string, Readonly<Record<string, string>>>> = {}
): Mirror => {
  const values = tokenValues(ds);
  const notes: string[] = [];
  const resolve = (name: string, value: string): string | null => {
    const resolved = resolveCss(value, variableIn(values));
    if (resolved === null) {
      notes.push(`${name}: ${value} does not resolve to a value.`);
    }
    return resolved;
  };
  const group = <A>(
    tokens: readonly Token[],
    prefix: string,
    accept: (value: string) => A | null,
    wanted: string
  ) => groupOf(tokens, prefix, resolve, accept, wanted, notes);

  const colors = group(
    ds.colors.flatMap((g) => g.tokens),
    "color-",
    (value) => (isColor(value) ? value : null),
    "a colour DESIGN.md can hold"
  );
  const rounded = group(ds.radius, "radius-", lengthOf, LENGTH);
  const spacing = group(
    [
      { name: "spacing-base", value: ds.spacing.base },
      ...(ds.spacing.tokens ?? []),
    ],
    "spacing-",
    spacingOf,
    LENGTH
  );

  const typography: Record<string, Typography> = {};
  for (const style of ds.typography.styles) {
    const settings = typographyOf(style, values, notes);
    if (Object.keys(settings).length > 0) {
      typography[textStyleKey(style)] = settings;
    }
  }

  const known = { colors, rounded, spacing };
  return {
    groups: {
      colors,
      components: componentGroup(components, known, values, notes),
      rounded,
      spacing,
      typography,
    },
    notes,
  };
};

/** A setting of a text style as CSS: a token's value, a number of pixels, or the CSS it is. */
const settingOf = (
  setting: number | string,
  values: ReadonlyMap<string, string>
): string | null => {
  if (typeof setting === "number") {
    return `${formatNumber(setting)}px`;
  }
  const raw = isToken(setting) ? values.get(tokenName(setting)) : setting;
  return raw === undefined ? null : resolveCss(raw, variableIn(values));
};

const typographyOf = (
  style: TextStyle,
  values: ReadonlyMap<string, string>,
  notes: string[]
): Typography => {
  const out: Record<string, number | string> = {};
  const where = `text style ${style.name}`;
  const length = (field: string, setting: number | string | undefined) => {
    if (setting === undefined) {
      return;
    }
    const value = settingOf(setting, values);
    if (value !== null && isDimension(value)) {
      out[field] = value;
    } else {
      notes.push(`${where}: its ${field} ${String(setting)} is not a length.`);
    }
  };

  const font =
    style.font ?? (values.has(BODY_FONT) ? `$${BODY_FONT}` : undefined);
  if (font !== undefined) {
    const stack = settingOf(font, values);
    const family = stack === null ? null : familyOf(stack);
    if (family !== null) {
      out.fontFamily = family;
    }
  }
  length("fontSize", style.size);

  if (style.weight !== undefined) {
    const weight =
      typeof style.weight === "number"
        ? String(style.weight)
        : settingOf(style.weight, values);
    if (weight !== null && isPlainNumber(weight)) {
      out.fontWeight = Number(weight);
    } else {
      notes.push(
        `${where}: its weight ${String(style.weight)} is not a number.`
      );
    }
  }

  const leading = lineHeightOf(style, values);
  if (leading !== null) {
    out.lineHeight = leading;
  }
  length("letterSpacing", style.tracking);
  return out as Typography;
};

/** The style's line height, or the one its size token is paired with; null when neither reads. */
const lineHeightOf = (
  style: TextStyle,
  values: ReadonlyMap<string, string>
): number | string | null => {
  const { lineHeight, size } = style;
  if (typeof lineHeight === "number") {
    return lineHeight < MAX_LINE_HEIGHT_FACTOR
      ? lineHeight
      : `${formatNumber(lineHeight)}px`;
  }
  const raw =
    lineHeight ??
    (size !== undefined && isToken(size)
      ? `$${tokenName(size)}--line-height`
      : undefined);
  if (raw === undefined) {
    return null;
  }
  const value = settingOf(raw, values);
  if (value === null) {
    return null;
  }
  if (isPlainNumber(value)) {
    return Number(formatNumber(Number(value)));
  }
  return isDimension(value) ? value : null;
};

const COMPONENT_COLORS = new Set(["backgroundColor", "textColor"]);

/** A component token's properties in the order the format lists them. */
const PROP_ORDER = [
  "backgroundColor",
  "textColor",
  "typography",
  "rounded",
  "padding",
  "size",
  "height",
  "width",
];
const rank = (prop: string) => {
  const at = PROP_ORDER.indexOf(prop);
  return at === -1 ? PROP_ORDER.length : at;
};

/**
 * Component tokens as the front matter holds them: a token the front matter has becomes a
 * reference to it (`$color-primary` → `{colors.primary}`), another its value; what the format
 * cannot hold is left out.
 */
const componentGroup = (
  components: Readonly<Record<string, Readonly<Record<string, string>>>>,
  known: Pick<TokenGroups, "colors" | "rounded" | "spacing">,
  values: ReadonlyMap<string, string>,
  notes: string[]
): Record<string, Record<string, string>> => {
  const has = (path: string) => {
    const [group = "", key = ""] = path.split(".");
    return (
      (known as Record<string, Record<string, unknown>>)[group]?.[key] !==
      undefined
    );
  };
  const out: Record<string, Record<string, string>> = {};
  for (const [key, props] of Object.entries(components)) {
    const entry: Record<string, string> = {};
    const ordered = Object.entries(props).sort(([a], [b]) => rank(a) - rank(b));
    for (const [prop, given] of ordered) {
      const value = componentValue(prop, given, has, values);
      if (value === null) {
        notes.push(
          `components.${key}.${prop}: ${given} is not a value DESIGN.md can hold.`
        );
      } else {
        entry[prop] = value;
      }
    }
    if (Object.keys(entry).length > 0) {
      out[key] = entry;
    }
  }
  return out;
};

const componentValue = (
  prop: string,
  given: string,
  has: (path: string) => boolean,
  values: ReadonlyMap<string, string>
): string | null => {
  if (given.startsWith("{")) {
    return given;
  }
  if (isToken(given)) {
    const name = tokenName(given);
    const path = documentPathOf(name);
    if (path !== null && has(path)) {
      return `{${path}}`;
    }
    const raw = values.get(name);
    const resolved =
      raw === undefined ? null : resolveCss(raw, variableIn(values));
    return resolved === null
      ? null
      : componentValue(prop, resolved, has, values);
  }
  if (COMPONENT_COLORS.has(prop)) {
    return isColor(given) ? given : null;
  }
  return isDimension(given) ? given : null;
};

/** The variant that changes a component's colours, by the names libraries give it. */
const COLOR_AXES = ["variant", "intent", "color", "tone", "appearance"];
const SIZE_AXIS = "size";
const SIZE_PROPS = new Set(["height", "padding", "size", "width"]);
const UPPER_RE = /([a-z0-9])([A-Z])/g;

/** `DropdownMenuItem` → `dropdown-menu-item`. */
const kebab = (name: string) => tokenKeyOf(name.replace(UPPER_RE, "$1-$2"));

/** A length as CSS: a number is pixels, as the design document has it. */
const lengthCss = (value: string | number) =>
  typeof value === "number" ? `${value}px` : value;

/** Padding as one value: the same on every side, or the four sides as CSS writes them. */
const paddingCss = (padding: Padding): string | null => {
  if (typeof padding === "number" || typeof padding === "string") {
    return lengthCss(padding);
  }
  const sides = [padding.top, padding.right, padding.bottom, padding.left].map(
    (side) => lengthCss(side ?? 0)
  );
  return new Set(sides).size === 1 ? (sides[0] ?? null) : null;
};

/** A slot's style fields as DESIGN.md's component tokens hold them: what the format has a name for. */
const tokensOfStyle = (style: SpecStyle): Record<string, string> => {
  const out: Record<string, string> = {};
  if (style.fill !== undefined) {
    out.backgroundColor = style.fill;
  }
  if (style.color !== undefined) {
    out.textColor = style.color;
  }
  if (style.radius !== undefined) {
    out.rounded = lengthCss(style.radius);
  }
  const padding =
    style.padding === undefined ? null : paddingCss(style.padding);
  if (padding !== null) {
    out.padding = padding;
  }
  if (style.height !== undefined) {
    out.height = lengthCss(style.height);
  }
  if (style.width !== undefined) {
    out.width = lengthCss(style.width);
  }
  return out;
};

/** A component spec as DESIGN.md's component tokens are read from it (ADR 0027, 0029). */
export type SpecLike = Pick<
  ComponentSpec,
  "base" | "component" | "defaults" | "draft" | "look" | "variants"
>;

/**
 * The component tokens of the components whose look the project owns (ADR 0027, 0040): a spec
 * with the design's look, its root slot's fields as the format holds them. `button` as it
 * starts, `button-<variant>` for each other member of the variant that changes its colours, and
 * `button-<size>` for each other size, its dimensions alone. A system component in its default look, or
 * a draft, writes nothing.
 */
export const specEntries = (
  specs: readonly SpecLike[]
): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  for (const spec of specs) {
    if (spec.look === "design" && spec.draft === undefined) {
      Object.assign(out, entriesOf(spec));
    }
  }
  return out;
};

/** One spec's entries: as it starts, each other colour variant, each other size. */
const entriesOf = (spec: SpecLike): Record<string, Record<string, string>> => {
  const key = kebab(spec.component);
  /** The root's fields with each axis at its default, or at the member `choice` names. */
  const rootFor = (choice: Readonly<Record<string, string>>) =>
    tokensOfStyle(
      Object.assign(
        {},
        spec.base[ROOT_SLOT],
        ...Object.entries(spec.variants).map(
          ([axis, members]) =>
            members[choice[axis] ?? spec.defaults[axis] ?? ""]?.[ROOT_SLOT]
        )
      )
    );
  const out: Record<string, Record<string, string>> = {};
  const add = (name: string, entry: Readonly<Record<string, string>>) => {
    if (Object.keys(entry).length > 0) {
      out[name] = { ...entry };
    }
  };
  add(key, rootFor({}));
  /** The members of an axis other than the one it starts with. */
  const others = (axis: string | undefined) =>
    axis === undefined
      ? []
      : Object.keys(spec.variants[axis] ?? {}).filter(
          (member) => member !== spec.defaults[axis]
        );
  const colorAxis = COLOR_AXES.find((a) => spec.variants[a]);
  for (const member of others(colorAxis)) {
    add(`${key}-${kebab(member)}`, rootFor({ [colorAxis ?? ""]: member }));
  }
  for (const member of others(SIZE_AXIS)) {
    add(
      `${key}-${kebab(member)}`,
      Object.fromEntries(
        Object.entries(rootFor({ [SIZE_AXIS]: member })).filter(([prop]) =>
          SIZE_PROPS.has(prop)
        )
      )
    );
  }
  return out;
};
