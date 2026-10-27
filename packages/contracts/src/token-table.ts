/**
 * The token table: for each kind of token, the prefix its names start with and the list of the
 * design system it is kept in. The spacing base, `--spacing`, is a token of its own, named
 * `spacing` and kept as `spacing.base`; a font size carries the line height paired with it.
 * Everything that walks, adds, changes or takes out a design system's tokens goes through this
 * module rather than naming the lists itself, so a kind is never left out of one of them.
 *
 * Pure, and works on a design system's JSON before it is decoded where it says so: a file written
 * after ADR 0035 keeps no values, and one written before it may lack some.
 */
import type {
  DesignSystem,
  FontFamily,
  FontSizeToken,
  Token,
} from "./design-system.ts";
import type { TokenChange, TokenKind } from "./tokens.ts";

/** The spacing base's name: `--spacing`, the step every spacing utility multiplies. */
export const SPACING_BASE = "spacing";

/** What a font size's line height is called beside it: `text-sm--line-height`. */
export const lineHeightName = (name: string): string => `${name}--line-height`;

/** One kind of token: what its names start with and where the design system lists it. */
export interface TokenKindEntry {
  readonly kind: Exclude<TokenKind, "other">;
  /**
   * Where the design system lists it, as a path of its JSON: `*` is each of the colour groups,
   * whose `tokens` are the list.
   */
  readonly list: readonly string[];
  /** The prefixes its names start with, the kind's own first. */
  readonly prefixes: readonly [string, ...string[]];
}

/**
 * Every kind a design system lists, in the order they are walked. A name in none of them is of
 * kind `other`, which the design system has no list for.
 */
export const TOKEN_TABLE: readonly TokenKindEntry[] = [
  { kind: "color", list: ["colors", "*", "tokens"], prefixes: ["color-"] },
  { kind: "spacing", list: ["spacing", "tokens"], prefixes: ["spacing-"] },
  { kind: "fontSize", list: ["typography", "sizes"], prefixes: ["text-"] },
  {
    kind: "fontWeight",
    list: ["typography", "weights"],
    prefixes: ["font-weight-"],
  },
  { kind: "font", list: ["typography", "fonts"], prefixes: ["font-"] },
  { kind: "leading", list: ["typography", "leading"], prefixes: ["leading-"] },
  {
    kind: "tracking",
    list: ["typography", "tracking"],
    prefixes: ["tracking-"],
  },
  { kind: "radius", list: ["radius"], prefixes: ["radius-"] },
  {
    kind: "shadow",
    list: ["shadows"],
    prefixes: ["shadow-", "inset-shadow-", "drop-shadow-", "text-shadow-"],
  },
  {
    kind: "borderWidth",
    list: ["borderWidths"],
    prefixes: ["border-width-"],
  },
  {
    kind: "breakpoint",
    list: ["layout", "breakpoints"],
    prefixes: ["breakpoint-"],
  },
  {
    kind: "container",
    list: ["layout", "containers"],
    prefixes: ["container-"],
  },
  { kind: "easing", list: ["motion", "easings"], prefixes: ["ease-"] },
  { kind: "duration", list: ["motion", "durations"], prefixes: ["duration-"] },
  { kind: "animation", list: ["motion", "animations"], prefixes: ["animate-"] },
];

/** Every prefix with its kind, the longest first: `font-weight-` is tried before `font-`. */
const BY_PREFIX = TOKEN_TABLE.flatMap((entry) =>
  entry.prefixes.map((prefix) => [prefix, entry] as const)
).sort(([a], [b]) => b.length - a.length);

const entryOf = (name: string): TokenKindEntry | undefined =>
  name === SPACING_BASE
    ? undefined
    : BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1];

/** What kind of token a name is, from the namespace it is in. */
export const tokenKindOf = (name: string): TokenKind =>
  name === SPACING_BASE ? "spacing" : (entryOf(name)?.kind ?? "other");

/** The prefix a kind's names start with: `color-`; empty for `other`. */
export const tokenPrefix = (kind: TokenKind): string =>
  TOKEN_TABLE.find((entry) => entry.kind === kind)?.prefixes[0] ?? "";

/** A token as a list holds it: a font size has its line height, a font where it is loaded from. */
export type ListedToken = Token &
  Partial<Pick<FontSizeToken, "lineHeight">> &
  Partial<Pick<FontFamily, "source">>;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every list at a path of the table, the colour groups' each. */
const listsAt = (node: unknown, path: readonly string[]): unknown[][] => {
  const [key, ...more] = path;
  if (key === undefined) {
    return Array.isArray(node) ? [node] : [];
  }
  if (key === "*") {
    return Array.isArray(node) ? node.flatMap((n) => listsAt(n, more)) : [];
  }
  return isRec(node) ? listsAt(node[key], more) : [];
};

/** The JSON with every list at a path mapped by `f`, the rest as it is; a list it lacks stays out. */
const mapListsAt = (
  node: unknown,
  path: readonly string[],
  f: (list: readonly unknown[]) => unknown[]
): unknown => {
  const [key, ...more] = path;
  if (key === undefined) {
    return Array.isArray(node) ? f(node) : node;
  }
  if (key === "*") {
    return Array.isArray(node) ? node.map((n) => mapListsAt(n, more, f)) : node;
  }
  if (!(isRec(node) && key in node)) {
    return node;
  }
  return { ...node, [key]: mapListsAt(node[key], more, f) };
};

const mapLists = (
  json: unknown,
  f: (list: readonly unknown[]) => unknown[]
): unknown =>
  TOKEN_TABLE.reduce((acc, entry) => mapListsAt(acc, entry.list, f), json);

/**
 * Every token of a design system's JSON, mapped by `f`, the rest as it is. Works on what the
 * file holds before it is decoded, a token's value left out included.
 */
export const mapTokenRecords = (
  json: unknown,
  f: (token: Rec) => Rec
): unknown => mapLists(json, (list) => list.map((t) => (isRec(t) ? f(t) : t)));

/** Every token a design system lists, mapped by `f`. The spacing base is not one of them. */
export const mapTokens = (
  ds: DesignSystem,
  f: (token: Token) => Token
): DesignSystem =>
  mapTokenRecords(ds, (t) => f(t as Token) as Rec) as DesignSystem;

/** Every token a design system lists, in the table's order. The spacing base is not one of them. */
export const listedTokens = (ds: DesignSystem): ListedToken[] =>
  TOKEN_TABLE.flatMap((entry) =>
    listsAt(ds, entry.list).flat()
  ) as ListedToken[];

/**
 * Every token of a design system once, each with its other themes' values: the spacing base
 * first, as `spacing`, then what the lists hold. A name listed twice is the first one.
 */
export const allTokens = (ds: DesignSystem): ListedToken[] => {
  const seen = new Set<string>();
  return [
    { name: SPACING_BASE, value: ds.spacing.base },
    ...listedTokens(ds),
  ].filter((t) => {
    const fresh = !seen.has(t.name);
    seen.add(t.name);
    return fresh;
  });
};

/** The JSON with `tokens` at the end of the list at `path`, the objects on the way made. */
const appendAt = (
  node: unknown,
  path: readonly string[],
  tokens: readonly Token[]
): unknown => {
  const [key, ...more] = path;
  if (key === undefined) {
    return [...(Array.isArray(node) ? node : []), ...tokens];
  }
  const rec = isRec(node) ? node : {};
  return { ...rec, [key]: appendAt(rec[key], more, tokens) };
};

/** Colours go into the semantic group, the first group when there is none, a new one when none. */
const addColors = (
  ds: DesignSystem,
  colors: readonly Token[]
): DesignSystem => {
  if (colors.length === 0) {
    return ds;
  }
  if (ds.colors.length === 0) {
    return { ...ds, colors: [{ name: "Colors", tokens: [...colors] }] };
  }
  const semantic = Math.max(
    0,
    ds.colors.findIndex((g) => g.name.toLowerCase() === "semantic")
  );
  return {
    ...ds,
    colors: ds.colors.map((g, i) =>
      i === semantic ? { ...g, tokens: [...g.tokens, ...colors] } : g
    ),
  };
};

/**
 * The design system with tokens listed where their kind goes, after the tokens there: a colour in
 * the semantic group (the first group when there is none), any other kind in its list, `spacing`
 * as the spacing base. A token of no kind the table knows has no list, and is left out.
 */
export const addTokens = (
  ds: DesignSystem,
  tokens: readonly Token[]
): DesignSystem => {
  let next = ds;
  for (const t of tokens) {
    if (t.name === SPACING_BASE) {
      next = { ...next, spacing: { ...next.spacing, base: t.value } };
    }
  }
  for (const entry of TOKEN_TABLE) {
    const own = tokens.filter((t) => entryOf(t.name) === entry);
    if (own.length === 0) {
      continue;
    }
    next =
      entry.kind === "color"
        ? addColors(next, own)
        : (appendAt(next, entry.list, own) as DesignSystem);
  }
  return next;
};

/** A design system without the tokens of these names, wherever it lists them. */
export const removeTokens = (
  ds: DesignSystem,
  names: ReadonlySet<string>
): DesignSystem =>
  names.size === 0
    ? ds
    : (mapLists(ds, (list) =>
        list.filter((t) => !(isRec(t) && names.has(t.name as string)))
      ) as DesignSystem);

/** A token with the changes of its name made: its value, another theme's set or taken out. */
const applyChanges = (t: Token, own: readonly TokenChange[]): Token => {
  let next: Token = t;
  for (const c of own) {
    if (c.theme === undefined) {
      next = c.value === undefined ? next : { ...next, value: c.value };
    } else if (c.remove || c.value === undefined) {
      const { [c.theme]: _gone, ...rest } = { ...next.values };
      next = { ...next, values: rest };
    } else {
      next = { ...next, values: { ...next.values, [c.theme]: c.value } };
    }
  }
  return next;
};

/** The token a name's changes make when the design system does not list it yet, if they make one. */
const newToken = (name: string, own: readonly TokenChange[]): Token[] => {
  const value = own.find((c) => c.theme === undefined)?.value;
  if (value === undefined) {
    return [];
  }
  const values = Object.fromEntries(
    own.flatMap((c) =>
      c.theme !== undefined && c.value !== undefined
        ? [[c.theme, c.value] as const]
        : []
    )
  );
  return [{ name, value, ...(Object.keys(values).length > 0 && { values }) }];
};

/**
 * A design system with token changes made to it: a value set where the token is listed, a token
 * not listed yet added where its kind goes (`addTokens`) once it has a value in the default
 * theme, a removal taken out. `spacing` sets the spacing base, which is never taken out.
 */
export const withTokenChanges = (
  ds: DesignSystem,
  changes: readonly TokenChange[]
): DesignSystem => {
  const byName = new Map<string, TokenChange[]>();
  for (const c of changes) {
    byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  }
  let { base } = ds.spacing;
  for (const c of byName.get(SPACING_BASE) ?? []) {
    if (c.theme === undefined && c.value !== undefined) {
      base = c.value;
    }
  }
  byName.delete(SPACING_BASE);
  const listed = new Set(listedTokens(ds).map((t) => t.name));
  const removed = new Set(
    changes.filter((c) => c.remove && c.theme === undefined).map((c) => c.name)
  );
  const changed = removeTokens(
    mapTokens(ds, (t) => {
      const own = byName.get(t.name);
      return own ? applyChanges(t, own) : t;
    }),
    removed
  );
  const added = [...byName.entries()]
    .filter(([name]) => !(listed.has(name) || removed.has(name)))
    .flatMap(([name, own]) => newToken(name, own));
  const withAdded = added.length > 0 ? addTokens(changed, added) : changed;
  return base === ds.spacing.base
    ? withAdded
    : { ...withAdded, spacing: { ...withAdded.spacing, base } };
};

/** A token's values, the default theme's and the others', as another side has them. */
export interface TokenValues {
  readonly name: string;
  readonly value: string;
  readonly values?: Readonly<Record<string, string>> | undefined;
}

/**
 * The values of `tokens` laid over a design system: theirs win where both have one, and a token
 * only they have is listed where its kind goes. An empty value is no value.
 */
export const layValues = (
  ds: DesignSystem,
  tokens: readonly TokenValues[]
): DesignSystem =>
  withTokenChanges(
    ds,
    tokens.flatMap((t) => [
      ...(t.value === "" ? [] : [{ name: t.name, value: t.value }]),
      ...Object.entries(t.values ?? {})
        .filter(([, value]) => value !== "")
        .map(([theme, value]) => ({ name: t.name, theme, value })),
    ])
  );

/**
 * The values `found` has for the tokens of a design system whose value is empty, the spacing
 * base too; the other themes' come with them when the token has none. What is not empty stays.
 */
export const fillValues = (
  ds: DesignSystem,
  found: (name: string) => TokenValues | undefined
): DesignSystem => {
  const merged = mapTokens(ds, (t) => {
    const other = t.value === "" ? found(t.name) : undefined;
    return other
      ? {
          ...t,
          value: other.value,
          ...(other.values && !t.values && { values: { ...other.values } }),
        }
      : t;
  });
  const base = merged.spacing.base === "" ? found(SPACING_BASE) : undefined;
  return base
    ? { ...merged, spacing: { ...merged.spacing, base: base.value } }
    : merged;
};

/**
 * A design system's JSON without its values (ADR 0035): no token's `value` or `values`, and no
 * spacing base, which `design.tokens.json` holds.
 */
export const stripValues = (ds: DesignSystem): Record<string, unknown> => {
  const json = mapTokenRecords(
    ds,
    ({ value: _value, values: _values, ...t }) => t
  ) as Record<string, unknown> & Pick<DesignSystem, "spacing">;
  const { base: _base, ...spacing } = json.spacing;
  return { ...json, spacing };
};

/**
 * A design system's JSON, before it is decoded, with every value it leaves out given as empty,
 * the spacing base's too: what `stripValues` wrote, ready for its values to be laid over it.
 */
export const withEmptyValues = (json: unknown): unknown => {
  const filled = mapTokenRecords(json, (t) =>
    "value" in t ? t : { ...t, value: "" }
  );
  if (!(isRec(filled) && isRec(filled.spacing)) || "base" in filled.spacing) {
    return filled;
  }
  return { ...filled, spacing: { ...filled.spacing, base: "" } };
};
