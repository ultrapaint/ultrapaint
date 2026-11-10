/**
 * The token table: for each kind of token, the prefix its names start with and the list of the
 * design system it is kept in. The spacing base, `--spacing`, is a token of its own, named
 * `spacing` and kept as `spacing.base`; a font size carries the line height paired with it.
 * Everything that walks, adds, changes or takes out a design system's tokens goes through this
 * module rather than naming the lists itself, so a kind is never left out of one of them.
 *
 * It owns the spacing scale too: a page's `$spacing-4` and a class's `p-4` are 4 × the spacing
 * base, a step no list holds, which only a named spacing (`spacing-gutter`) overrides. And it
 * answers which tokens of a kind hold a value (`tokensByValue`), for Figma's colours, the code's
 * values written out and Sync's matches alike.
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
import { DETAILED_GROUPS } from "./token-presets.ts";
import {
  type Comparable,
  comparable,
  formatNumber,
  ROOT_PX,
  sameAs,
  toPx,
} from "./token-value.ts";
import type { TokenChange, TokenKind } from "./tokens.ts";

/** The spacing base's name: `--spacing`, the step every spacing utility multiplies. */
export const SPACING_BASE = "spacing";

/** The spacing base a design system that sets none has: Tailwind's, a step of 4px. */
export const DEFAULT_SPACING_BASE = "0.25rem";
const DEFAULT_BASE_PX = 0.25 * ROOT_PX;

/**
 * The steps of the spacing scale that have a name of their own (`p-4`, `gap-0.5`), each a
 * multiple of the spacing base. Tailwind takes any multiple; these are the ones a designer is
 * offered, the same wherever a spacing is picked.
 */
export const SPACING_STEPS: readonly number[] = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24,
  28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
];

const SPACING_STEP_RE = /^spacing-(\d+(?:\.\d+)?)$/;

/**
 * The step of the spacing scale a name is, `spacing-4` → 4, `spacing-2.5` → 2.5: a multiple of the
 * base, as `$spacing-4` in a page and `p-4` in a class (whose value is the name's step). Null for
 * a named spacing (`spacing-gutter`, `spacing-4x`), the base itself and any other name.
 */
export const spacingStepOf = (name: string): number | null => {
  const step: RegExpExecArray | null = SPACING_STEP_RE.exec(name);
  return step?.[1] === undefined ? null : Number(step[1]);
};

/** The name of a step of the spacing scale: 4 → `spacing-4`, 2.5 → `spacing-2.5`. */
export const spacingStepName = (step: number): string =>
  `${SPACING_BASE}-${formatNumber(step)}`;

/**
 * One step of the spacing scale in pixels: the base's length (an `em` as the root's), else the
 * default's 4 when there is no base or it is no positive length.
 */
export const spacingBasePx = (base: string | null | undefined): number => {
  const px = base ? toPx(base, { em: ROOT_PX }) : null;
  return px !== null && px > 0 ? px : DEFAULT_BASE_PX;
};

/**
 * The step of the spacing scale a length in pixels is, 16 → 4 on a 4px base: a whole or half
 * step. Tailwind takes any quarter of one, but past the half steps its scale has always had
 * (`p-2.5`) a length reads as off the grid; null for one.
 */
export const spacingStepAt = (px: number, basePx: number): number | null => {
  const step = px / basePx;
  const half = Math.round(step * 2) / 2;
  return Math.abs(half - step) < 0.001 ? half : null;
};

/** What a font size's line height is called beside it: `text-sm--line-height`. */
export const lineHeightName = (name: string): string => `${name}--line-height`;

/** One kind of token: what its names start with and where the design system lists it. */
interface TokenKindEntry {
  readonly kind: Exclude<TokenKind, "other">;
  /**
   * Where the design system lists it, as a path of its JSON: `*` is each of the colour groups,
   * whose `tokens` are the list.
   */
  readonly list: readonly string[];
  /** Whole names of the kind beside its prefixes: Tailwind's `default-transition-duration`. */
  readonly names?: readonly string[];
  /** The prefixes its names start with, the kind's own first. */
  readonly prefixes: readonly [string, ...string[]];
}

/**
 * Every kind a design system lists, in the order they are walked. A name in none of them is of
 * kind `other`, which the design system has no list for.
 */
export const TOKEN_TABLE: readonly TokenKindEntry[] = [
  {
    kind: "color",
    list: ["colors", "*", "tokens"],
    // A detailed preset's colours are in Tailwind v4's per-property namespaces (ADR 0062).
    prefixes: ["color-", "text-color-", "background-color-", "border-color-"],
  },
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
  {
    kind: "duration",
    list: ["motion", "durations"],
    // Tailwind's own duration for `transition`, when nothing else says how long.
    names: ["default-transition-duration"],
    prefixes: ["duration-"],
  },
  { kind: "animation", list: ["motion", "animations"], prefixes: ["animate-"] },
];

/** Every prefix with its kind, the longest first: `font-weight-` is tried before `font-`. */
const BY_PREFIX = TOKEN_TABLE.flatMap((entry) =>
  entry.prefixes.map((prefix) => [prefix, entry] as const)
).sort(([a], [b]) => b.length - a.length);

const entryOf = (name: string): TokenKindEntry | undefined =>
  name === SPACING_BASE
    ? undefined
    : (TOKEN_TABLE.find((entry) => entry.names?.includes(name)) ??
      BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1]);

/** What kind of token a name is, from the namespace it is in. */
export const tokenKindOf = (name: string): TokenKind =>
  name === SPACING_BASE ? "spacing" : (entryOf(name)?.kind ?? "other");

/** The prefix a kind's names start with: `color-`; empty for `other`. */
export const tokenPrefix = (kind: TokenKind): string =>
  TOKEN_TABLE.find((entry) => entry.kind === kind)?.prefixes[0] ?? "";

/** A token's name without its kind's own prefix, as a picker shows it: `color-card` → `card`. */
export const shortName = (name: string): string => {
  const prefix = tokenPrefix(tokenKindOf(name));
  return prefix !== "" && name.startsWith(prefix)
    ? name.slice(prefix.length)
    : name;
};

/**
 * The name a kind's short name stands for, `shortName` the other way: `card` → `color-card`. One
 * in another of the kind's namespaces is the name already (`text-color-subtle`).
 */
export const nameOfShort = (kind: TokenKind, short: string): string => {
  const [own = "", ...others] =
    TOKEN_TABLE.find((entry) => entry.kind === kind)?.prefixes ?? [];
  return others.some((prefix) => short.startsWith(prefix))
    ? short
    : `${own}${short}`;
};

const TOKEN_NAME_RE = /^[a-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*$/;
/** A dot between two digits, `1.5`: a step, which the stylesheet writes as `1_5`. */
const STEP_DOT_RE = /(\d)\.(?=\d)/g;
/** An underscore between two digits, `1_5`: the stylesheet's way of writing the dot of a step. */
const STEP_UNDERSCORE_RE = /(\d)_(?=\d)/g;
const DIGITS_UNDERSCORE_RE = /\d_\d/;
const VARIABLE_DASHES_RE = /^--/;

/** What a token's name is made of, as a problem says it. */
export const TOKEN_NAME_SHAPE =
  "letters, digits and _ in words joined by one dash, a dot only between digits (color-primary, spacing-1.5)";

/**
 * Whether a name can be a token's: one a stylesheet declares as a variable (`variableOf`) and reads
 * back as that token, so a name added in the editor or matched in Sync is one the code and the
 * tokens file hold too. A dot stands only between digits, `spacing-1.5`, and is written `1_5` as
 * Tailwind writes it, so `_` between digits is the dot's and not a name's own. `--` starts what
 * belongs to a token (`text-sm--line-height`). Its kind is `tokenKindOf`'s to say.
 */
export const isTokenName = (name: string): boolean =>
  !DIGITS_UNDERSCORE_RE.test(name) &&
  TOKEN_NAME_RE.test(name.replace(STEP_DOT_RE, "$1"));

/** The custom property a token is: `color-primary` → `--color-primary`, `spacing-1.5` → `--spacing-1_5`. */
export const variableOf = (name: string): string =>
  `--${name.replace(STEP_DOT_RE, "$1_")}`;

/** The token a custom property is, `variableOf` the other way: `--spacing-1_5` → `spacing-1.5`. */
export const nameOfVariable = (variable: string): string =>
  variable.replace(VARIABLE_DASHES_RE, "").replace(STEP_UNDERSCORE_RE, "$1.");

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
 * The tokens a design system lists of one kind, in its list's order: the colours of every group,
 * the named spacings without the base. None for `other`.
 */
export const tokensOfKind = (
  ds: DesignSystem | null | undefined,
  kind: TokenKind
): ListedToken[] => {
  const entry = TOKEN_TABLE.find((e) => e.kind === kind);
  return ds && entry ? (listsAt(ds, entry.list).flat() as ListedToken[]) : [];
};

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

/**
 * Each design system's tokens by name, found the first time one is asked for: the colour boards
 * ask for a token per colour per theme. A design system is never changed in place, so what was
 * found holds for as long as the object does.
 */
const tokensByName = new WeakMap<
  DesignSystem,
  ReadonlyMap<string, ListedToken>
>();

/** A token of a design system by its name, the spacing base as `spacing`, with its values. */
export const tokenOf = (
  ds: DesignSystem | null | undefined,
  name: string
): ListedToken | undefined => {
  if (!ds) {
    return;
  }
  let named = tokensByName.get(ds);
  if (!named) {
    named = new Map(allTokens(ds).map((t) => [t.name, t] as const));
    tokensByName.set(ds, named);
  }
  return named.get(name);
};

/** A token held against a value: of its own kind when it says one, else its name's. */
interface ValuedToken {
  readonly kind?: TokenKind;
  readonly name: string;
  readonly value: string;
}

/** The tokens of a kind that hold a value, in the order they were given. */
export type ValueLookup<T extends ValuedToken> = (
  kind: TokenKind,
  value: string
) => readonly T[];

/**
 * Which of these tokens of a kind hold a value, by token-value's notion of the same value
 * (`sameValue`): `#2b7fff` finds a colour written `oklch(62.3% 0.214 259.815)`, `6px` a radius of
 * `0.375rem`. Every token found, in the order given (a design system's is `listedTokens`'s or
 * `tokensOfKind`'s); which of several to take is the caller's. Each token's value is read once,
 * and a value asked for again is answered from what was found.
 */
export const tokensByValue = <T extends ValuedToken>(
  tokens: readonly T[]
): ValueLookup<T> => {
  const byKind = new Map<TokenKind, [T, Comparable][]>();
  for (const t of tokens) {
    const kind = t.kind ?? tokenKindOf(t.name);
    const own = byKind.get(kind) ?? [];
    own.push([t, comparable(t.value)]);
    byKind.set(kind, own);
  }
  const found = new Map<string, readonly T[]>();
  return (kind, value) => {
    const key = `${kind} ${value}`;
    const known = found.get(key);
    if (known) {
      return known;
    }
    const wanted = comparable(value);
    const same = (byKind.get(kind) ?? []).flatMap(([t, c]) =>
      sameAs(c, wanted) ? [t] : []
    );
    found.set(key, same);
    return same;
  };
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

/**
 * The group a colour goes into: in a detailed system (ADR 0062) the group of its namespace
 * (`border-color-warning` in Border), else the semantic group, the first when there is none.
 */
const colorGroupOf = (groups: DesignSystem["colors"], name: string): number => {
  const named = (wanted: string) =>
    groups.findIndex((g) => g.name.toLowerCase() === wanted.toLowerCase());
  const detailed = DETAILED_GROUPS.find((d) => name.startsWith(d.prefix));
  const own = detailed ? named(detailed.name) : -1;
  return own >= 0 ? own : Math.max(0, named("semantic"));
};

/** Colours go each into its group (`colorGroupOf`), a new one when the design system has none. */
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
  return {
    ...ds,
    colors: ds.colors.map((g, i) => {
      const own = colors.filter((c) => colorGroupOf(ds.colors, c.name) === i);
      return own.length > 0 ? { ...g, tokens: [...g.tokens, ...own] } : g;
    }),
  };
};

/**
 * The design system with tokens listed where their kind goes, after the tokens there: a colour in
 * its group (`colorGroupOf`), any other kind in its list, `spacing` as the spacing base. A token
 * of no kind the table knows has no list, and is left out.
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

/**
 * What changed in the tokens' values from one design system to the next, as a side is told it: a
 * value set in the default theme or another, another theme's value taken out, a token taken out.
 * The spacing base is `spacing`; an empty value is no value.
 */
export const tokenChangesBetween = (
  before: DesignSystem,
  after: DesignSystem
): TokenChange[] => {
  const was = new Map(allTokens(before).map((t) => [t.name, t] as const));
  const changes: TokenChange[] = [];
  const now = allTokens(after);
  for (const t of now) {
    const old = was.get(t.name);
    if (t.value !== "" && t.value !== old?.value) {
      changes.push({ name: t.name, value: t.value });
    }
    const values = t.values ?? {};
    for (const [theme, value] of Object.entries(values)) {
      if (value !== "" && value !== old?.values?.[theme]) {
        changes.push({ name: t.name, theme, value });
      }
    }
    for (const theme of Object.keys(old?.values ?? {})) {
      if (!values[theme]) {
        changes.push({ name: t.name, remove: true, theme });
      }
    }
  }
  const kept = new Set(now.map((t) => t.name));
  for (const name of was.keys()) {
    if (!kept.has(name)) {
      changes.push({ name, remove: true });
    }
  }
  return changes;
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
