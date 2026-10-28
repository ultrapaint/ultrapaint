/**
 * The sync's engine (ADR 0025, 0027, 0028), pure: a side's tokens compared with the design
 * system's, value by value, against what the two last agreed on; the changes a user's picks come
 * to; the matches an agent or the user gives; and where the two agree once a sync is written.
 *
 * A side is the code, Figma or DESIGN.md. Its adapter (`sync-sides.ts`, with the pure readings
 * in `sync-readings.ts`) says what its tokens are, what each is in the design system
 * (by name for the code; by the rules and the saved matches for Figma and DESIGN.md) and where
 * its baseline is kept; the rule for one value is `@ultrapaint/contracts/agreement`, which
 * DESIGN.md's mirror uses too.
 */
import {
  type Agreed,
  agreedAfter,
  outcomeOf,
} from "@ultrapaint/contracts/agreement";
import {
  baselineKey,
  type MatchSource,
  type TokenDecision,
  type TokenDiff,
  type TokenMatchInput,
} from "@ultrapaint/contracts/sync";
import { tokenKindOf } from "@ultrapaint/contracts/token-table";
import { inCodeUnits, sameValue } from "@ultrapaint/contracts/token-value";
import type {
  SourceToken,
  TokenChange,
  TokenKind,
} from "@ultrapaint/contracts/tokens";

/** A token as a side has it, named as pages name tokens, with its value per theme. */
export interface SideToken {
  /** The side's token its default value points at, by `variable`. */
  readonly alias?: string;
  /** What the side calls it for good: Figma's id. */
  readonly id?: string;
  readonly kind: TokenKind;
  /** Its name the design system's way, as the side's own naming comes to (`color-brand-500`). */
  readonly name: string;
  /** Its values by theme, `""` the default. */
  readonly values: Readonly<Record<string, string>>;
  /** Where it is in the side: `Colors/Primary/500`, `colors.primary`, `color-primary`. */
  readonly variable: string;
}

/** What a side's token is in the design system, and who said so: `to` its token, null left out. */
export interface Match {
  /** Left out for the code, whose tokens are the design system's by name. */
  readonly by?: MatchSource;
  readonly to: string | null;
}

/** A side as the engine compares it. */
export interface Side {
  /** What two values of a token last agreed on, by the design system's name; null when nothing. */
  readonly agreed: (
    name: string,
    theme: string,
    token: SideToken | undefined
  ) => Agreed | null;
  /** What each token is in the design system, by `variable`; one missing is unmatched. */
  readonly matches: ReadonlyMap<string, Match>;
  readonly tokens: readonly SideToken[];
  /**
   * Whether the side waits for a value of the design system's it does not have, by baseline
   * key: the code does, which an export writes. Absent, the design system's other tokens are not
   * the side's to have (Figma, DESIGN.md), and only the side's own are compared.
   */
  readonly waitsFor?: (key: string) => boolean;
}

const valueIn = (token: SourceToken | undefined, theme: string) =>
  theme === "" ? token?.value : token?.values?.[theme];

const byKey = (a: TokenDiff, b: TokenDiff) => {
  const ka = baselineKey(a.name, a.theme);
  const kb = baselineKey(b.name, b.theme);
  if (ka === kb) {
    return 0;
  }
  return ka < kb ? -1 : 1;
};

/** One value of a side's token against the design system's. */
const diffOf = (
  side: Side,
  declared: ReadonlyMap<string, SourceToken>,
  token: SideToken,
  theme: string,
  value: string
): TokenDiff => {
  const match = side.matches.get(token.variable);
  const common = {
    ...(token.alias && { alias: token.alias }),
    kind: token.kind,
    source: value,
    ...(theme && { theme }),
    variable: token.variable,
  };
  if (!match) {
    return { ...common, name: token.name, outcome: "unmatched" };
  }
  const by = match.by && { by: match.by };
  if (match.to === null) {
    return { ...common, ...by, name: token.name, outcome: "ignored" };
  }
  const current = valueIn(declared.get(match.to), theme);
  const agreed = side.agreed(match.to, theme, token);
  return {
    ...common,
    ...(agreed?.source !== undefined && { base: agreed.source }),
    ...by,
    ...(current !== undefined && { design: current }),
    name: match.to,
    outcome: outcomeOf(value, current, agreed),
  };
};

/** The design system's values a side waits for and does not have, but for the keys it has. */
const waitingOf = (
  side: Side,
  declared: ReadonlyMap<string, SourceToken>,
  covered: ReadonlySet<string>,
  waitsFor: (key: string) => boolean
): TokenDiff[] =>
  [...declared.values()].flatMap((token) =>
    ["", ...Object.keys(token.values ?? {})].flatMap((theme): TokenDiff[] => {
      const key = baselineKey(token.name, theme || undefined);
      const value = valueIn(token, theme);
      if (covered.has(key) || value === undefined || !waitsFor(key)) {
        return [];
      }
      const agreed = side.agreed(token.name, theme, undefined);
      return [
        {
          ...(agreed?.source !== undefined && { base: agreed.source }),
          design: value,
          kind: token.kind,
          name: token.name,
          outcome: outcomeOf(undefined, value, agreed),
          ...(theme && { theme }),
          variable: token.name,
        },
      ];
    })
  );

const isMatched = (d: TokenDiff) =>
  d.outcome !== "unmatched" && d.outcome !== "ignored";

/**
 * A side's tokens against the design system's, theme by theme, against what was agreed last.
 * Only a matched token is compared: an unmatched one is listed and left alone, and one left out
 * of the design system is listed as such. A side that waits for the design system's values has
 * them listed too, in the order of their keys.
 */
export const compareSide = (
  side: Side,
  design: readonly SourceToken[]
): TokenDiff[] => {
  const declared = new Map(design.filter((t) => t.own).map((t) => [t.name, t]));
  const diffs = side.tokens.flatMap((token) =>
    Object.entries(token.values).map(([theme, value]) =>
      diffOf(side, declared, token, theme, value)
    )
  );
  const { waitsFor } = side;
  if (!waitsFor) {
    return diffs;
  }
  const covered = new Set(
    diffs.filter(isMatched).map((d) => baselineKey(d.name, d.theme))
  );
  return [...diffs, ...waitingOf(side, declared, covered, waitsFor)].sort(
    byKey
  );
};

/**
 * The diffs of a comparison for the tokens named, by name (every theme of it) or by
 * `name@theme`; every diff when none is named.
 */
export const namedDiffs = (
  diffs: readonly TokenDiff[],
  names: readonly string[]
): TokenDiff[] => {
  if (names.length === 0) {
    return [...diffs];
  }
  const wanted = new Set(names);
  return diffs.filter(
    (d) => wanted.has(d.name) || wanted.has(baselineKey(d.name, d.theme))
  );
};

/** What a comparison comes to once the user has picked, for each way a change can go. */
export interface SideChanges {
  /**
   * To the design system: what the side changed alone and the conflicts given to it, in the
   * design system's units. Two of a side's tokens matched to one: the first one's value.
   */
  readonly toDesign: readonly TokenChange[];
  /**
   * To the side: what the design system changed alone and the conflicts given to it, a token it
   * took out taken out. Only the code is written; Figma is left as it is, and DESIGN.md follows
   * the design system through its mirror.
   */
  readonly toSource: readonly TokenChange[];
}

const pickOf = (decisions: readonly TokenDecision[]) => {
  const picked = new Map(
    decisions.map((d) => [baselineKey(d.name, d.theme), d.take])
  );
  return (d: TokenDiff) => picked.get(baselineKey(d.name, d.theme));
};

const takenIn = (d: TokenDiff, pick: TokenDecision["take"] | undefined) =>
  d.outcome === "to-design" || (d.outcome === "conflict" && pick === "source");

const givenOut = (d: TokenDiff, pick: TokenDecision["take"] | undefined) =>
  d.outcome === "source-behind" ||
  (d.outcome === "conflict" && pick === "design");

/**
 * The changes a comparison comes to once the user has picked, one way only when asked: `import`
 * takes into the design system, `export` writes the side.
 */
export const changesOf = (
  diffs: readonly TokenDiff[],
  decisions: readonly TokenDecision[],
  only?: "export" | "import"
): SideChanges => {
  const pickFor = pickOf(decisions);
  const toDesign = new Map<string, TokenChange>();
  const toSource: TokenChange[] = [];
  for (const d of diffs) {
    const key = baselineKey(d.name, d.theme);
    const pick = pickFor(d);
    const target = { name: d.name, ...(d.theme && { theme: d.theme }) };
    if (
      takenIn(d, pick) &&
      only !== "export" &&
      d.source !== undefined &&
      !toDesign.has(key)
    ) {
      toDesign.set(key, {
        ...target,
        value: inCodeUnits(d.source, d.design),
      });
    }
    if (givenOut(d, pick) && only !== "import") {
      toSource.push(
        d.design === undefined
          ? { ...target, remove: true }
          : { ...target, value: d.design }
      );
    }
  }
  return { toDesign: [...toDesign.values()], toSource };
};

/**
 * The keys a sync settles, by baseline key: every matched value of the comparison it went
 * through, except a conflict the user did not pick and a change the way it did not go. A
 * baseline that keeps both sides' values keeps the difference of a settled one, so the user is
 * not asked again.
 */
export const settledKeys = (
  diffs: readonly TokenDiff[],
  decisions: readonly TokenDecision[],
  only?: "export" | "import"
): Set<string> => {
  const pickFor = pickOf(decisions);
  const settled = new Set<string>();
  for (const d of diffs.filter(isMatched)) {
    const pick = pickFor(d);
    const open =
      (d.outcome === "conflict" && pick === undefined) ||
      (takenIn(d, pick) && only === "export") ||
      (givenOut(d, pick) && only === "import");
    if (!open) {
      settled.add(baselineKey(d.name, d.theme));
    }
  }
  return settled;
};

/**
 * Where a side and the design system agree once a sync is written, by baseline key, in order:
 * for each key, what they share now; the difference when the sync settled it; otherwise what
 * was agreed before. `keys` are the values the sync is about, both sides' by default.
 */
export const agreementAfter = (input: {
  readonly design: Readonly<Record<string, string>>;
  readonly keys?: Iterable<string>;
  readonly previous: (key: string) => Agreed | null;
  readonly settled?: ReadonlySet<string>;
  readonly source: Readonly<Record<string, string>>;
}): Record<string, Agreed> => {
  const keys = input.keys ?? [
    ...Object.keys(input.design),
    ...Object.keys(input.source),
  ];
  const out: [string, Agreed][] = [];
  for (const key of new Set(keys)) {
    const agreed = agreedAfter(
      input.source[key],
      input.design[key],
      input.previous(key),
      input.settled?.has(key) ?? false
    );
    if (agreed) {
      out.push([key, agreed]);
    }
  }
  return Object.fromEntries(out.sort(([a], [b]) => a.localeCompare(b)));
};

const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Why a side's token cannot be matched to a design token of that name, or null when it can: the
 * name has to be one the code could declare, of the token's kind.
 */
export const matchProblem = (
  token: Pick<SideToken, "kind" | "variable">,
  to: string
): string | null => {
  if (!TOKEN_NAME_RE.test(to)) {
    return `${to} is not a token name: lower case, words joined by dashes (color-primary)`;
  }
  const kind = tokenKindOf(to);
  return kind === token.kind
    ? null
    : `${token.variable} is a ${token.kind} token and ${to} names a ${kind} one`;
};

/** A match an agent or the user gives for one of a side's tokens; none to forget the one kept. */
export interface GivenMatch {
  readonly match:
    | { readonly by: MatchSource; readonly to: string | null }
    | undefined;
  readonly token: SideToken;
}

/**
 * Matches an agent or the user gives, checked against the side's tokens: by `variable`, the
 * match to keep, or undefined to forget the one kept. `what` names the side's tokens in a
 * problem: `a variable or style of tokens.fig`.
 */
export const matchEntries = (
  tokens: readonly SideToken[],
  entries: readonly TokenMatchInput[],
  by: Exclude<MatchSource, "rule">,
  what: string
): {
  readonly problems: readonly string[];
  readonly set: ReadonlyMap<string, GivenMatch>;
} => {
  const byVariable = new Map(tokens.map((t) => [t.variable, t] as const));
  const problems: string[] = [];
  const set = new Map<string, GivenMatch>();
  for (const entry of entries) {
    const token = byVariable.get(entry.variable);
    if (!token) {
      problems.push(`${entry.variable} is not ${what}`);
      continue;
    }
    const problem = entry.to ? matchProblem(token, entry.to) : null;
    if (problem) {
      problems.push(problem);
      continue;
    }
    set.set(entry.variable, {
      match: entry.to === undefined ? undefined : { by, to: entry.to },
      token,
    });
  }
  return { problems, set };
};

/**
 * What each of a side's tokens is among the design system's (the code's while there is none), by
 * `variable` (ADR 0025, 0027). What an agent or the user decided, kept in the side's baseline,
 * comes first. Rules then take only what is certain: there is a token of the same name, or
 * exactly one token of the kind with the same value; when several come to one token by value,
 * the one that points at another (a semantic colour over its palette entry) takes it, and a
 * palette entry a matched token points at is left out. The rest stays unmatched, and nothing of
 * it is written.
 */
export const matchByRules = (
  tokens: readonly SideToken[],
  design: readonly SourceToken[],
  saved: (token: SideToken) => Match | undefined
): Map<string, Match> => {
  const own = design.filter((t) => t.own);
  const declared = new Set(own.map((t) => t.name));
  const matched = new Map<string, Match>();
  const open: SideToken[] = [];
  for (const token of tokens) {
    const found = saved(token);
    if (found) {
      matched.set(token.variable, found);
    } else if (declared.has(token.name)) {
      matched.set(token.variable, { by: "rule", to: token.name });
    } else {
      open.push(token);
    }
  }
  const taken = new Set([...matched.values()].map((m) => m.to));
  const free = own.filter((t) => !taken.has(t.name));
  for (const [variable, to] of matchByValue(open, free)) {
    matched.set(variable, { by: "rule", to });
  }
  const pointedAt = new Set(
    tokens
      .filter((t) => typeof matched.get(t.variable)?.to === "string")
      .map((t) => t.alias)
  );
  for (const token of tokens) {
    if (!matched.has(token.variable) && pointedAt.has(token.variable)) {
      matched.set(token.variable, { by: "rule", to: null });
    }
  }
  return matched;
};

/**
 * A side's tokens that have the value of exactly one design token of their kind, by `variable`:
 * where several come to one design token, the one that points at another takes it, if only one
 * does.
 */
const matchByValue = (
  tokens: readonly SideToken[],
  design: readonly SourceToken[]
): Map<string, string> => {
  const byTarget = new Map<string, SideToken[]>();
  for (const token of tokens) {
    const same = design.filter(
      (t) => t.kind === token.kind && sameValue(token.values[""] ?? "", t.value)
    );
    const [target] = same;
    if (same.length === 1 && target) {
      byTarget.set(target.name, [...(byTarget.get(target.name) ?? []), token]);
    }
  }
  const found = new Map<string, string>();
  for (const [name, matched] of byTarget) {
    const aliases = matched.filter((t) => t.alias !== undefined);
    const [pick] = matched.length === 1 ? matched : aliases;
    if (pick && (matched.length === 1 || aliases.length === 1)) {
      found.set(pick.variable, name);
    }
  }
  return found;
};
