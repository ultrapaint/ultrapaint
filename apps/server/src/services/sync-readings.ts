/**
 * What each side of the sync (ADR 0025, 0027, 0028) is to the engine (`sync-engine.ts`), pure:
 * the design system's tokens as every side is compared with them; the code's, Figma's and
 * DESIGN.md's tokens, how they match the design system's, and what each side's baseline keeps.
 * The sides' adapters (`sync-sides.ts`) read and write them; the plan is `sync-plan.ts`.
 */
import { type Agreed, agreedOn } from "@ultrapaint/contracts/agreement";
import type {
  DesignSystem,
  DocumentBaseline,
} from "@ultrapaint/contracts/design-system";
import {
  baselineKey,
  type FigmaMatch,
  type SyncBaseline,
  type TokenDecision,
  type TokenDiff,
} from "@ultrapaint/contracts/sync";
import {
  allTokens,
  SPACING_BASE,
  tokenKindOf,
} from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import {
  agreementAfter,
  compareSide,
  type Match,
  matchByRules,
  namedDiffs,
  type Side,
  type SideToken,
} from "./sync-engine.ts";

/**
 * The design system's tokens as a side to compare with: every token it lists, the spacing base
 * as `spacing`, each with its value per theme. A token whose value is empty is left out.
 */
export const designTokensOf = (ds: DesignSystem): SourceToken[] =>
  allTokens(ds)
    .filter((t) => t.value !== "")
    .map((t) => ({
      kind: tokenKindOf(t.name),
      name: t.name,
      own: true,
      value: t.value,
      ...(t.values &&
        Object.keys(t.values).length > 0 && { values: { ...t.values } }),
    }));

/** Every value of a list of tokens by `name` and `name@theme`, as a baseline keeps them. */
const valuesByKey = (
  tokens: readonly SourceToken[]
): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const t of tokens) {
    values[baselineKey(t.name)] = t.value;
    for (const [theme, value] of Object.entries(t.values ?? {})) {
      values[baselineKey(t.name, theme)] = value;
    }
  }
  return values;
};

/** A key of a baseline that keeps one value for both sides, as the engine reads it. */
const oneValue =
  (agreed: Readonly<Record<string, string>> | undefined) => (key: string) =>
    agreedOn(agreed?.[key]);

/** What two values last agreed on as a baseline keeps them, kept as one value each. */
const asOneValue = (agreed: Readonly<Record<string, Agreed>>) =>
  Object.fromEntries(
    Object.entries(agreed).flatMap(([key, a]) =>
      a.source === undefined ? [] : [[key, a.source] as const]
    )
  );

/** Figma's side (ADR 0025) ---------------------------------------------------------------- */

/** The key a Figma token's match is kept under: Figma's id, its place when it has none. */
export const matchKeyOf = (token: {
  readonly id?: string;
  readonly variable: string;
}) => token.id ?? token.variable;

/**
 * What each of Figma's tokens is in the design system (the code while there is none), by
 * `variable`: the matches kept in the baseline by Figma's id first, by place for a variable
 * whose id changed (the file copied, a library published again), then the rules.
 */
export const matchFigma = (
  figma: readonly SideToken[],
  design: readonly SourceToken[],
  saved: Readonly<Record<string, FigmaMatch>> | undefined
): Map<string, Match> => {
  const byPlace = new Map(
    Object.values(saved ?? {}).map((m) => [m.figma, m] as const)
  );
  return matchByRules(figma, design, (token) => {
    const found = saved?.[matchKeyOf(token)] ?? byPlace.get(token.variable);
    return found && { by: found.by, to: found.to };
  });
};

/** What Figma and the design system each held for a value at the last sync, by key. */
const figmaAgreed = (baseline: SyncBaseline | null) => (key: string) => {
  const source = baseline?.figma[key];
  const design = baseline?.code[key];
  return source === undefined && design === undefined
    ? null
    : {
        ...(design !== undefined && { design }),
        ...(source !== undefined && { source }),
      };
};

/** Figma's tokens as the engine compares them, against the last sync with this file. */
export const figmaSide = (
  figma: readonly SideToken[],
  design: readonly SourceToken[],
  baseline: SyncBaseline | null
): Side => {
  const agreed = figmaAgreed(baseline);
  return {
    agreed: (name, theme) => agreed(baselineKey(name, theme || undefined)),
    matches: matchFigma(figma, design, baseline?.matches),
    tokens: figma,
  };
};

/** Figma's tokens against the design system's, against the last sync with this file (ADR 0025). */
export const compareFigma = (
  figma: readonly SideToken[],
  design: readonly SourceToken[],
  baseline: SyncBaseline | null
): TokenDiff[] => compareSide(figmaSide(figma, design, baseline), design);

/**
 * The baseline a sync with Figma leaves: for every matched value, Figma's and the design
 * system's now, a difference the sync settled kept as it is (Figma is never written), a conflict
 * left open kept as it was agreed before; and what every token of the file is in the design
 * system, the rules' matches too, so the code changing later does not move a token the user has
 * seen written.
 */
export const figmaBaselineAfter = (input: {
  readonly at: number;
  /** The baseline the comparison was made against. */
  readonly baseline: SyncBaseline | null;
  /** The design system's tokens once the changes are written. */
  readonly design: readonly SourceToken[];
  readonly diffs: readonly TokenDiff[];
  readonly file: string;
  readonly settled: ReadonlySet<string>;
  readonly side: Side;
}): SyncBaseline => {
  const source: Record<string, string> = {};
  const keys: string[] = [];
  for (const d of input.diffs) {
    if (d.outcome === "unmatched" || d.outcome === "ignored") {
      continue;
    }
    const key = baselineKey(d.name, d.theme);
    keys.push(key);
    if (d.source !== undefined && !(key in source)) {
      source[key] = d.source;
    }
  }
  const agreed = agreementAfter({
    design: valuesByKey(input.design.filter((t) => t.own)),
    keys,
    previous: figmaAgreed(input.baseline),
    settled: input.settled,
    source,
  });
  const code: Record<string, string> = {};
  const figma: Record<string, string> = {};
  for (const [key, a] of Object.entries(agreed)) {
    if (a.design !== undefined) {
      code[key] = a.design;
    }
    if (a.source !== undefined) {
      figma[key] = a.source;
    }
  }
  return {
    at: input.at,
    code,
    figma,
    file: input.file,
    matches: Object.fromEntries(
      input.side.tokens
        .flatMap((token) => {
          const match = input.side.matches.get(token.variable);
          return match
            ? [
                [
                  matchKeyOf(token),
                  {
                    by: match.by ?? "rule",
                    figma: token.variable,
                    to: match.to,
                  },
                ] as const,
              ]
            : [];
        })
        .sort(([a], [b]) => a.localeCompare(b))
    ),
  };
};

/** DESIGN.md's side (ADR 0027) ------------------------------------------------------------- */

/** DESIGN.md's tokens as a side's: one value each, in the default theme. */
export const documentSideTokens = (
  tokens: readonly {
    readonly alias?: string;
    readonly kind: SourceToken["kind"];
    readonly name: string;
    readonly value: string;
    readonly variable: string;
  }[]
): SideToken[] =>
  tokens.map((t) => ({
    ...(t.alias !== undefined && { alias: t.alias }),
    kind: t.kind,
    name: t.name,
    values: { "": t.value },
    variable: t.variable,
  }));

/**
 * DESIGN.md's tokens as the engine compares them: matched by the same rules as Figma's, the
 * matches kept by path; what the two agreed is one value by path, the document's and the design
 * system's being the same then.
 */
const documentSide = (
  tokens: readonly SideToken[],
  design: readonly SourceToken[],
  baseline: DocumentBaseline | null
): Side => {
  const agreed = oneValue(baseline?.agreed);
  return {
    agreed: (_name, _theme, token) => (token ? agreed(token.variable) : null),
    matches: matchByRules(
      tokens,
      design,
      (token) => baseline?.matches?.[token.variable]
    ),
    tokens,
  };
};

/** DESIGN.md's tokens against the design system's, against what the two agreed (ADR 0027). */
export const compareDocument = (
  tokens: readonly SideToken[],
  design: readonly SourceToken[],
  baseline: DocumentBaseline | null
): TokenDiff[] => compareSide(documentSide(tokens, design, baseline), design);

/** The code's side (ADR 0028) -------------------------------------------------------------- */

/**
 * The code's tokens as the engine compares them. Both sides name tokens the same way, so each
 * is the design system's of its name, and one the design system leaves out on purpose
 * (`omitted`) is left out. A style system's own default counts as the code having the token when
 * the design system lists it, but is never offered. The code waits for every value of the
 * design system's it does not have, except the spacing base: a code that does not name it has
 * the style system's.
 */
const codeSide = (
  code: readonly SourceToken[],
  design: readonly SourceToken[],
  baseline: DocumentBaseline | null,
  omitted: ReadonlySet<string>
): Side => {
  const ours = valuesByKey(design);
  const theirs = valuesByKey(code);
  const listed = new Map(design.map((t) => [t.name, t] as const));
  const tokens = code
    .filter((t) => t.own || listed.has(t.name))
    .map((t): SideToken => {
      const values = Object.entries({ "": t.value, ...t.values }).filter(
        ([theme]) => t.own || baselineKey(t.name, theme || undefined) in ours
      );
      return {
        kind: listed.get(t.name)?.kind ?? t.kind,
        name: t.name,
        values: Object.fromEntries(values),
        variable: t.name,
      };
    });
  const agreed = oneValue(baseline?.agreed);
  return {
    agreed: (name, theme) => agreed(baselineKey(name, theme || undefined)),
    matches: new Map(
      tokens.map((t) => [
        t.variable,
        { to: omitted.has(t.name) && !listed.has(t.name) ? null : t.name },
      ])
    ),
    tokens,
    waitsFor: (key) => key !== SPACING_BASE || key in theirs,
  };
};

/**
 * The code's tokens against the design system's (ADR 0028), theme by theme, against what the two
 * last agreed on: only the design system has it, waiting for the code (`source-behind`); only
 * the code, new there (`to-design`) unless left out on purpose (`ignored`); both, as the engine
 * says.
 */
export const compareCode = (
  code: readonly SourceToken[],
  design: readonly SourceToken[],
  baseline: DocumentBaseline | null,
  omitted: ReadonlySet<string>
): TokenDiff[] =>
  compareSide(codeSide(code, design, baseline, omitted), design);

/**
 * What the design system and the code agree on (ADR 0028), kept in `codeSync`: the last
 * agreement, with every value they now share taken as agreed, and what neither has any more
 * dropped. Worked out again whenever either is written.
 */
export const codeAgreement = (
  ds: DesignSystem,
  code: readonly SourceToken[]
): DocumentBaseline => {
  const previous = ds.codeSync;
  return {
    agreed: asOneValue(
      agreementAfter({
        design: valuesByKey(designTokensOf(ds)),
        previous: oneValue(previous?.agreed),
        source: valuesByKey(code),
      })
    ),
    at: previous?.at ?? 0,
    ...(previous?.matches && { matches: previous.matches }),
  };
};

/**
 * What an agent asks of the code comparison (ADR 0028), `export` (the design's values to the
 * code) or `import` (the code's into the design): the picks it comes to, and what it leaves. A
 * token named is taken that way even where both sides changed it, which is how an agent settles
 * a conflict the user decided; with none named, only what changed on that side alone is, and
 * the conflicts are left for the user.
 */
export const codeDirection = (
  diffs: readonly TokenDiff[],
  direction: "export" | "import",
  names: readonly string[]
): {
  readonly decisions: TokenDecision[];
  /** The conflicts left, none being named. */
  readonly left: TokenDiff[];
  /** Names that are no token of either side. */
  readonly unknown: string[];
} => {
  const chosen = namedDiffs(diffs, names);
  const conflicts = chosen.filter((d) => d.outcome === "conflict");
  const known = new Set(
    diffs.flatMap((d) => [d.name, baselineKey(d.name, d.theme)])
  );
  return {
    decisions:
      names.length === 0
        ? []
        : conflicts.map((d) => ({
            name: d.name,
            take: direction === "export" ? "design" : "source",
            ...(d.theme && { theme: d.theme }),
          })),
    left: names.length === 0 ? conflicts : [],
    unknown: names.filter((n) => !known.has(n)),
  };
};
