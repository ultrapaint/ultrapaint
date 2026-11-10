/**
 * The document's tokens: its groups as the format types them, and as the design system names
 * them, so they can be matched to its tokens and compared (ADR 0027). `colors.primary` is
 * `color-primary`, `rounded.md` is `radius-md`, `spacing.base` is `spacing`.
 */
import { SPACING_BASE, tokenPrefix } from "@ultrapaint/contracts/token-table";
import { isColor, parseNumber } from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import {
  MIRRORED_GROUPS,
  type MirroredGroup,
  pathParts,
  type TokenGroups,
  type Typography,
} from "./format.ts";
import type { DesignMd } from "./parse.ts";
import { isDimension } from "./values.ts";

const REF_RE = /^\{([^{}]+)\}$/;

/** The path a `{colors.primary}` reference names, or null for a value. */
export const refOf = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  // Typed by hand: the linter otherwise takes the result for non-null.
  const match: RegExpExecArray | null = REF_RE.exec(value.trim());
  return match?.[1] ?? null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const DIMENSION_FIELDS = ["fontSize", "letterSpacing"] as const;
const STRING_FIELDS = ["fontFamily", "fontFeature", "fontVariation"] as const;

/** A weight as a number, quoted or not, as the format allows. */
const weightOf = (
  key: string,
  weight: unknown,
  problems: string[]
): number | undefined => {
  if (typeof weight !== "number" && typeof weight !== "string") {
    return;
  }
  // As CSS writes a number: `Number` would take "" for 0 and "0x10" for 16.
  const n = typeof weight === "number" ? weight : parseNumber(weight);
  if (n !== null && Number.isFinite(n)) {
    return n;
  }
  problems.push(`typography.${key}.fontWeight: ${weight} is not a number.`);
};

/** A line height: a multiple of the size, quoted or not, or a length. */
const lineHeightOf = (
  key: string,
  leading: unknown,
  problems: string[]
): number | string | undefined => {
  if (typeof leading === "number") {
    return leading;
  }
  if (typeof leading !== "string") {
    return;
  }
  if (isDimension(leading)) {
    return leading;
  }
  const n = parseNumber(leading);
  if (n !== null && Number.isFinite(n)) {
    return n;
  }
  problems.push(
    `typography.${key}.lineHeight: ${leading} is neither a number nor a length.`
  );
};

const typographyOf = (
  key: string,
  value: unknown,
  problems: string[]
): Typography | null => {
  if (!isRecord(value)) {
    problems.push(`typography.${key} is not a set of type settings.`);
    return null;
  }
  const out: Record<string, number | string> = {};
  for (const field of STRING_FIELDS) {
    const v = value[field];
    if (typeof v === "string") {
      out[field] = v;
    }
  }
  for (const field of DIMENSION_FIELDS) {
    const v = value[field];
    if (typeof v === "string" && (isDimension(v) || refOf(v))) {
      out[field] = v;
    } else if (v !== undefined) {
      problems.push(
        `typography.${key}.${field}: ${String(v)} is not a length in px, em or rem.`
      );
    }
  }
  const weight = weightOf(key, value.fontWeight, problems);
  if (weight !== undefined) {
    out.fontWeight = weight;
  }
  const leading = lineHeightOf(key, value.lineHeight, problems);
  if (leading !== undefined) {
    out.lineHeight = leading;
  }
  return out as Typography;
};

/** A group's string tokens that `accept` takes, or that refer to another token. */
const typedGroup = (
  group: string,
  record: Record<string, unknown>,
  accept: (value: string) => boolean,
  wanted: string,
  problems: string[]
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && (accept(value) || refOf(value))) {
      out[key] = value;
    } else {
      problems.push(`${group}.${key}: ${String(value)} is not ${wanted}.`);
    }
  }
  return out;
};

/**
 * The mirrored groups as the document has them, typed: a colour, a length, a number or a
 * reference where the format wants one. What does not fit is left out and said in `problems`.
 */
export const groupsOf = (
  doc: DesignMd
): { readonly groups: TokenGroups; readonly problems: readonly string[] } => {
  const problems: string[] = [];
  const records = Object.fromEntries(
    MIRRORED_GROUPS.map((group) => {
      const value = doc.values[group];
      if (value !== undefined && value !== null && !isRecord(value)) {
        problems.push(`${group} is not a map of tokens.`);
      }
      return [group, isRecord(value) ? value : {}];
    })
  ) as Record<MirroredGroup, Record<string, unknown>>;

  const colors = typedGroup(
    "colors",
    records.colors,
    isColor,
    "a colour",
    problems
  );
  const rounded = typedGroup(
    "rounded",
    records.rounded,
    isDimension,
    "a length in px, em or rem",
    problems
  );
  // The format keeps an unknown spacing value as a string (a column count, a ratio).
  const spacing: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(records.spacing)) {
    if (typeof value === "number" || typeof value === "string") {
      spacing[key] = value;
    }
  }
  const components: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(records.components)) {
    if (!isRecord(value)) {
      problems.push(`components.${key} is not a set of component properties.`);
      continue;
    }
    components[key] = Object.fromEntries(
      Object.entries(value).flatMap(([field, v]) =>
        typeof v === "string" || typeof v === "number"
          ? [[field, String(v)]]
          : []
      )
    );
  }
  const typography: Record<string, Typography> = {};
  for (const [key, value] of Object.entries(records.typography)) {
    const settings = typographyOf(key, value, problems);
    if (settings) {
      typography[key] = settings;
    }
  }
  return {
    groups: { colors, components, rounded, spacing, typography },
    problems,
  };
};

/** A token of the document, named as the code would name it. */
interface DocumentToken {
  /** The document token a reference points at, by path: `colors.blue-600`. */
  readonly alias?: string;
  readonly kind: TokenKind;
  /** The code's name for it: `color-primary`. */
  readonly name: string;
  /** Its value, references followed. */
  readonly value: string;
  /** Where it is in the document: `colors.primary`. */
  readonly variable: string;
}

const KEY_RE = /[^a-z0-9-]+/g;
const EDGE_DASHES_RE = /^-+|-+$/g;

/** A document key as a part of a code token's name: `DEFAULT` → `default`. */
export const tokenKeyOf = (key: string): string =>
  key.toLowerCase().replace(KEY_RE, "-").replace(EDGE_DASHES_RE, "");

/** The kind of token each group of the front matter holds, and its names' prefix in the code. */
const PREFIXES = {
  colors: { kind: "color", prefix: tokenPrefix("color") },
  rounded: { kind: "radius", prefix: tokenPrefix("radius") },
  spacing: { kind: "spacing", prefix: tokenPrefix("spacing") },
} as const satisfies Partial<
  Record<MirroredGroup, { kind: TokenKind; prefix: string }>
>;

/** The code's name for a document token, by group and key. */
const codeNameOf = (group: keyof typeof PREFIXES, key: string): string =>
  group === "spacing" && key === "base"
    ? SPACING_BASE
    : `${PREFIXES[group].prefix}${tokenKeyOf(key)}`;

const MAX_REF_DEPTH = 10;

const isValue = (v: unknown): v is number | string =>
  typeof v === "number" || typeof v === "string";

/**
 * What a path names in the front matter: the token of that key, which may hold dots
 * (`spacing.0.5`), or its field; else the path walked a part at a time, as the format reads
 * nested maps.
 */
const valueAt = (
  values: Readonly<Record<string, unknown>>,
  path: string
): unknown => {
  const { field, group, key } = pathParts(path);
  const tokens = values[group];
  const token = isRecord(tokens) ? tokens[key] : undefined;
  let named = token;
  if (field !== undefined) {
    named = isRecord(token) ? token[field] : undefined;
  }
  if (isValue(named)) {
    return named;
  }
  let node: unknown = values;
  for (const part of path.split(".")) {
    node = isRecord(node) ? node[part] : undefined;
  }
  return node;
};

/** A reference followed to a value, through other references; null when it goes nowhere. */
export const follow = (
  values: Readonly<Record<string, unknown>>,
  path: string,
  depth = 0
): string | null => {
  if (depth > MAX_REF_DEPTH) {
    return null;
  }
  const node = valueAt(values, path);
  if (typeof node === "number") {
    return String(node);
  }
  if (typeof node !== "string") {
    return null;
  }
  const next = refOf(node);
  return next === null ? node : follow(values, next, depth + 1);
};

/**
 * The colours, radii and spacing of a document as tokens the code could declare. Typography is
 * not among them: a text style is several tokens, matched by an agent (ADR 0027).
 */
export const documentTokens = (
  doc: DesignMd
): {
  readonly problems: readonly string[];
  readonly tokens: readonly DocumentToken[];
} => {
  const { groups, problems: typed } = groupsOf(doc);
  const problems = [...typed];
  const tokens: DocumentToken[] = [];
  for (const group of ["colors", "rounded", "spacing"] as const) {
    for (const [key, raw] of Object.entries(groups[group])) {
      const variable = `${group}.${key}`;
      const ref = refOf(raw);
      const value = ref === null ? String(raw) : follow(doc.values, ref);
      if (value === null) {
        problems.push(`${variable} refers to {${ref}}, which is not a token.`);
        continue;
      }
      tokens.push({
        ...(ref !== null && { alias: ref }),
        kind: PREFIXES[group].kind,
        name: codeNameOf(group, key),
        value,
        variable,
      });
    }
  }
  return { problems, tokens };
};

/**
 * Where a code token goes in the document, or null for one the front matter has no group for:
 * `color-accent` → `colors.accent`, `spacing` → `spacing.base`.
 */
export const documentPathOf = (name: string): string | null => {
  if (name === SPACING_BASE) {
    return "spacing.base";
  }
  for (const [group, { prefix }] of Object.entries(PREFIXES)) {
    if (name.startsWith(prefix)) {
      return `${group}.${name.slice(prefix.length)}`;
    }
  }
  return null;
};
