/**
 * The sync's rules (ADR 0025), pure: which case a project is in, what drifted between the
 * design system and the code, and the steps that bring them together; and what each side (the
 * code, Figma, DESIGN.md) is to the engine (`sync-engine.ts`): its tokens, how they match the
 * design system's, and what its baseline keeps.
 */
import { type Agreed, agreedOn } from "@ultrapaint/contracts/agreement";
import type {
  DesignSystem,
  DocumentBaseline,
} from "@ultrapaint/contracts/design-system";
import type {
  DesignSystemSetup,
  SetupStepId,
  SetupStepStatus,
} from "@ultrapaint/contracts/design-system-setup";
import {
  baselineKey,
  driftCount,
  emptyDrift,
  type FigmaMatch,
  type SyncBaseline,
  type SyncCase,
  type SyncDrift,
  type SyncFacts,
  type SyncStep,
  type SyncStepKind,
  type SyncStepState,
  type TokenDecision,
  type TokenDiff,
} from "@ultrapaint/contracts/sync";
import {
  allTokens,
  listedTokens,
  SPACING_BASE,
  tokenKindOf,
} from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { SECTIONS } from "@ultrapaint/design-md/format";
import { plural } from "@ultrapaint/shared/text";
import {
  agreementAfter,
  compareSide,
  type Match,
  matchByRules,
  type Side,
  type SideToken,
} from "./sync-engine.ts";

/** A few names, then how many more. */
const some = (names: readonly string[], shown = 4) =>
  names.length > shown
    ? `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`
    : names.join(", ");

/** What drifted between a design system and the code, by name. */
export const driftOf = (
  ds: DesignSystem | null,
  tokens: readonly SourceToken[],
  components: readonly string[],
  /** Whether the stylesheets were read at all: without them nothing can be said of tokens. */
  read: boolean
): SyncDrift => {
  if (!ds) {
    return emptyDrift;
  }
  const omitted = new Set(ds.omitted ?? []);
  const listed = new Set(listedTokens(ds).map((t) => t.name));
  const described = new Set(Object.keys(ds.components ?? {}));
  const have = new Set(components);
  return {
    componentsGone:
      components.length === 0
        ? []
        : [...described].filter((c) => !(have.has(c) || omitted.has(c))),
    componentsUndescribed: components.filter(
      (c) => !(described.has(c) || omitted.has(c))
    ),
    // A token the code does not declare is waiting for an export, not drift (ADR 0028).
    tokensGone: [],
    tokensUndescribed: read
      ? tokens
          .filter((t) => t.own && !(listed.has(t.name) || omitted.has(t.name)))
          .map((t) => t.name)
      : [],
  };
};

export const caseOf = (facts: SyncFacts): SyncCase => {
  if (facts.designSystem) {
    return "maintain";
  }
  if (facts.figma) {
    return facts.app ? "figma-code" : "figma";
  }
  return facts.app ? "code" : "scratch";
};

const SETUP_STATE: Record<SetupStepStatus, SyncStepState> = {
  active: "active",
  done: "done",
  review: "attention",
  stopped: "attention",
  todo: "todo",
};

const SETUP_TITLES: Record<SetupStepId, string> = {
  define: "Define the design system",
  inventory: "Read what the code uses",
  map: "Map what is off the system",
  migrate: "Bring the code onto it",
  verify: "Check the code again",
};

const SETUP_DETAILS: Record<SetupStepId, string> = {
  define:
    "An agent adopts the theme there is, or proposes one from what the code uses, and asks you what to keep.",
  inventory:
    "The colours, spacing, type, radii, shadows and plain elements the code uses, and which are the system's.",
  map: "What each value off the system becomes; rules take the exact matches, an agent the rest.",
  migrate:
    "The code rewritten onto the design system a directory at a time, each batch undoable.",
  verify: "How much of the code is still off the system.",
};

export interface PlanInput {
  readonly drift: SyncDrift;
  readonly facts: SyncFacts;
  /** The newest Figma import has been compared and synced since it came in. */
  readonly figmaSynced: boolean;
  readonly setup: DesignSystemSetup;
}

/** When nothing is under way or waiting, the first step needed and left is the one to do now. */
const withNext = (steps: SyncStep[]): SyncStep[] => {
  if (steps.some((s) => s.state === "attention" || s.state === "active")) {
    return steps;
  }
  const next = steps.findIndex((s) => s.state === "todo" && !s.optional);
  return steps.map((s, i) =>
    i === next ? { ...s, state: "attention" as const } : s
  );
};

/** The steps of a case, in order, each with where it is. */
export const planOf = (input: PlanInput): SyncStep[] =>
  withNext(stepsOf(input));

const step = (
  kind: SyncStepKind,
  title: string,
  state: SyncStepState,
  detail: string,
  optional = false
): SyncStep => ({
  detail,
  kind,
  ...(optional && { optional }),
  state,
  title,
});

const setupStepOf = (
  setup: DesignSystemSetup,
  id: SetupStepId,
  optional = false
): SyncStep => ({
  detail: SETUP_DETAILS[id],
  kind: id,
  ...(optional && { optional }),
  state: SETUP_STATE[setup.steps.find((s) => s.id === id)?.status ?? "todo"],
  title: SETUP_TITLES[id],
});

/** The settings step, when the settings point nowhere: no components, no stylesheet. */
const settingsSteps = (facts: SyncFacts): SyncStep[] => {
  if (!facts.app) {
    return [];
  }
  const missing = [
    facts.libraryDirs.length === 0 ? "no component directory is set" : null,
    // An empty component directory is a project with no components yet, not a wrong setting.
    facts.libraryDirs.length > 0 &&
    facts.components === 0 &&
    facts.librarySources !== 0
      ? `${facts.libraryDirs.join(", ")} has no components the editor can read`
      : null,
    facts.stylesheets === 0 ? "no stylesheet is set" : null,
  ].filter((p): p is string => p !== null);
  return missing.length === 0
    ? []
    : [
        step(
          "settings",
          "Point ultrapaint at your code",
          "attention",
          `${missing.join("; ")}. Detect proposes where they are; check it and apply.`
        ),
      ];
};

const figmaStepOf = (facts: SyncFacts, synced: boolean) => {
  const name = facts.figma?.name;
  // Without a design system yet, Figma's tokens go into the code it is then made from.
  const target = facts.designSystem ? "the design system" : "the code";
  return step(
    "figma-tokens",
    `Match Figma's tokens to ${target}'s`,
    synced ? "done" : "attention",
    synced
      ? `${name ?? "The Figma file"} and ${target} agree on every token matched.`
      : `Each variable and style of ${name ?? "the Figma file"} is matched to a token of ${target}, added under a name you choose, or left out: rules take the plain matches, an agent the rest with you. Then what Figma changed is taken, and you pick where both changed.`
  );
};

const framesStepOf = (optional: boolean) =>
  step(
    "import-frames",
    "Turn the Figma frames into pages",
    "todo",
    "An agent maps Figma's components to yours, asking where the names do not settle it, and writes each frame as a page.",
    optional
  );

/** What drifted, in words: the describe step's detail. */
const driftParts = (drift: SyncDrift) =>
  [
    [drift.tokensUndescribed, "token", "the design system does not list"],
    [drift.tokensGone, "token", "it lists that the code no longer declares"],
    [drift.componentsUndescribed, "component", "it says nothing about"],
    [drift.componentsGone, "component", "it notes that the code no longer has"],
  ]
    .filter(([names]) => (names as readonly string[]).length > 0)
    .map(([names, what, where]) => {
      const list = names as readonly string[];
      return `${plural(list.length, what as string)} ${where as string} (${some(list)})`;
    });

/**
 * DESIGN.md at the root of the repository (ADR 0027), once there is a design system to write
 * it from: moved from the designs directory, or written for the first time.
 */
const documentSteps = (facts: SyncFacts): SyncStep[] => {
  if (!facts.designSystem) {
    return [];
  }
  if (!facts.designMd) {
    return [
      step(
        "design-md",
        "Write DESIGN.md",
        "attention",
        "DESIGN.md is the design system in the open format every agent reads, at the root of the repository: its front matter holds the tokens, kept in step with the design system, and an agent describes the rest."
      ),
    ];
  }
  if (facts.designMd.held > 0 && !facts.designMd.legacy) {
    return [
      step(
        "design-tokens",
        "Take DESIGN.md's tokens into the design system",
        "attention",
        `${plural(facts.designMd.held, "value")} of ${facts.designMd.path}'s front matter changed there, or differ from the design system's. Each of its tokens is matched to a token of the design system, added under a name you choose, or left out: rules take the plain matches, an agent the rest with you. Then what the document changed is taken into the design system, and you pick where both changed.`
      ),
    ];
  }
  if (facts.designMd.legacy) {
    return [
      step(
        "design-md",
        "Move DESIGN.md to the repository root",
        "attention",
        `${facts.designMd.path} moves to the root of the repository, where agents outside the editor look for it, and its front matter is filled in with the design system's tokens.`
      ),
    ];
  }
  return [];
};

/** What DESIGN.md's prose still needs, in a sentence; empty when nothing. */
const proseOf = (facts: SyncFacts) => {
  const doc = facts.designMd;
  if (!doc || doc.legacy || doc.unwritten === 0) {
    return "";
  }
  return doc.unwritten === SECTIONS.length
    ? `${doc.path} has none of the format's sections written yet: an agent writes them, keeping what it says.`
    : `${doc.path} has ${plural(doc.unwritten, "section")} with nothing written under it.`;
};

const describeStepOf = (drift: SyncDrift, facts: SyncFacts) => {
  const drifted = driftCount(drift) > 0;
  const prose = proseOf(facts);
  const lead = drifted
    ? `The code has ${driftParts(drift).join("; ")}. An agent updates the design system, asking you what each is for.`
    : "";
  return step(
    "describe",
    "Describe what changed",
    drifted || prose ? "attention" : "done",
    drifted || prose
      ? [lead, prose].filter(Boolean).join(" ")
      : "The design system lists every token and component the code has."
  );
};

/**
 * The code against the design system (ADR 0028): what waits to be written to the code, what the
 * code changed alone, and what changed on both sides.
 */
const codeStepsOf = (facts: SyncFacts): SyncStep[] => {
  const counts = facts.codeTokens;
  if (!(counts && facts.app)) {
    return [];
  }
  if (counts.toCode + counts.toDesign + counts.conflicts === 0) {
    return [];
  }
  const parts = [
    counts.toCode > 0
      ? `${plural(counts.toCode, "token")} of the design ${counts.toCode === 1 ? "waits" : "wait"} for the code`
      : null,
    counts.toDesign > 0
      ? `${plural(counts.toDesign, "token")} changed in the code alone`
      : null,
    counts.conflicts > 0
      ? `${plural(counts.conflicts, "token")} changed on both sides`
      : null,
  ].filter((p): p is string => p !== null);
  return [
    step(
      "code-tokens",
      "Bring the code up to the design",
      "attention",
      `${parts.join("; ")}. Export writes the design's values into the stylesheets; what the code changed is taken into the design or written over, and you pick where both changed.`
    ),
  ];
};

const stepsOf = (input: PlanInput): SyncStep[] => {
  const { drift, facts, figmaSynced, setup } = input;
  const kind = caseOf(facts);
  const figma = kind === "figma" || kind === "figma-code";
  const head = settingsSteps(facts);
  if (kind === "maintain") {
    return [
      ...head,
      ...documentSteps(facts),
      describeStepOf(drift, facts),
      ...codeStepsOf(facts),
      ...(facts.figma
        ? [figmaStepOf(facts, figmaSynced), framesStepOf(true)]
        : []),
    ];
  }
  const start =
    kind === "scratch" || kind === "figma"
      ? [
          step(
            "scaffold",
            "Start an application",
            "attention",
            "A Vite, React and Tailwind v4 application with a set of components to start from, written into the repository."
          ),
        ]
      : [];
  const setupSteps =
    kind === "code" || kind === "figma-code"
      ? [
          setupStepOf(setup, "inventory"),
          setupStepOf(setup, "define"),
          setupStepOf(setup, "map", true),
          setupStepOf(setup, "migrate", true),
          setupStepOf(setup, "verify", true),
        ]
      : [setupStepOf(setup, "define")];
  return [
    ...head,
    ...start,
    ...(figma ? [figmaStepOf(facts, figmaSynced)] : []),
    ...setupSteps,
    ...(figma ? [framesStepOf(false)] : []),
  ];
};

const LEADS: Record<SyncCase, string> = {
  code: "The code has no design system yet: it is made from what the code uses.",
  figma:
    "There is a Figma file and no application: the application starts from Figma's tokens.",
  "figma-code":
    "There is a Figma file and an application without a design system: Figma's tokens are matched to the code's.",
  maintain: "The design system and the code are kept together.",
  scratch:
    "There is no application yet: one is started, and its design system with it.",
};

export const summaryOf = (
  kind: SyncCase,
  steps: readonly SyncStep[]
): string => {
  const next = steps.find(
    (s) => s.state === "attention" || s.state === "active"
  );
  const lead = LEADS[kind];
  if (!next) {
    return kind === "maintain"
      ? `${lead} Nothing to do: they agree.`
      : `${lead} Every step is done.`;
  }
  const title = next.title.charAt(0).toLowerCase() + next.title.slice(1);
  return `${lead} Next: ${title}.`;
};

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
export const valuesByKey = (
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
export const documentSide = (
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
export const codeSide = (
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

/** How many of a code comparison's tokens wait for each side, and for the user. */
export const codeCounts = (diffs: readonly TokenDiff[]) => ({
  conflicts: diffs.filter((d) => d.outcome === "conflict").length,
  toCode: diffs.filter((d) => d.outcome === "source-behind").length,
  toDesign: diffs.filter((d) => d.outcome === "to-design").length,
});

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
