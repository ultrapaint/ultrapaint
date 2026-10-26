/**
 * The sync's rules (ADR 0025), pure: which case a project is in, what drifted between the
 * design system and the code, and the steps that bring them together.
 */
import {
  type DesignSystem,
  type DocumentBaseline,
  designSystemTokenNames,
  mapTokens,
  type Token,
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
  type FigmaMatchSource,
  type SyncBaseline,
  type SyncCase,
  type SyncDrift,
  type SyncFacts,
  type SyncStep,
  type SyncStepKind,
  type SyncStepState,
  type TokenDecision,
  type TokenDiff,
  type TokenOutcome,
} from "@ultrapaint/contracts/sync";
import {
  type SourceToken,
  type TokenChange,
  tokenKindOf,
} from "@ultrapaint/contracts/tokens";
import { SECTIONS } from "@ultrapaint/design-md/format";
import { plural } from "@ultrapaint/shared/text";
import { inCodeUnits, sameValue } from "./token-values.ts";

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
  const listed = new Set(designSystemTokenNames(ds));
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

/**
 * `design.tokens.json` against the design system (ADR 0028): what another tool changed in it
 * alone, changed on both sides, or what the design system changed while the file kept its own.
 */
const dtcgStepsOf = (facts: SyncFacts): SyncStep[] => {
  const counts = facts.designTokens;
  if (!counts || counts.behind + counts.toDesign + counts.conflicts === 0) {
    return [];
  }
  const parts = [
    counts.toDesign > 0
      ? `${plural(counts.toDesign, "token")} changed in design.tokens.json alone, by another tool`
      : null,
    counts.conflicts > 0
      ? `${plural(counts.conflicts, "token")} changed on both sides`
      : null,
    counts.behind > 0
      ? `${plural(counts.behind, "token")} of the design system it does not have yet`
      : null,
  ].filter((p): p is string => p !== null);
  return [
    step(
      "dtcg-tokens",
      "Take design.tokens.json's changes into the design system",
      "attention",
      `${parts.join("; ")}. What the file changed is taken into the design system, you pick where both changed, and the file is written again from the design system.`
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
      ...dtcgStepsOf(facts),
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

/** A token as Figma has it, named as pages name tokens (`@ultrapaint/figma-import/tokens`). */
export interface FigmaSide {
  /** The Figma token its default mode points at, by `variable`. */
  readonly alias?: string;
  readonly id?: string;
  readonly kind: SourceToken["kind"];
  readonly name: string;
  readonly values: Readonly<Record<string, string>>;
  readonly variable: string;
}

/** The key a Figma token's match is kept under: Figma's id, its place when it has none. */
export const matchKeyOf = (token: {
  readonly id?: string;
  readonly variable: string;
}) => token.id ?? token.variable;

/** What a Figma token is in the design system (the code while there is none), and who said so. */
export interface Matched {
  readonly by: FigmaMatchSource;
  /** The code's token; null when it is left out. */
  readonly to: string | null;
}

/**
 * What each of Figma's tokens is among the tokens it is matched to, the design system's or the
 * code's while there is none, by `variable` (ADR 0025). What an agent or the user decided, kept
 * in the baseline, comes first. Rules then take only what is certain: there is a token of the
 * same name, or exactly one token of the kind with the same value; when several of Figma's come
 * to one token by value, the one that points at another (a semantic
 * colour over its palette entry) takes it, and a palette entry a matched token points at is left
 * out. The rest stays unmatched, and nothing of it is written.
 */
export const matchFigma = (
  figma: readonly FigmaSide[],
  code: readonly SourceToken[],
  saved: Readonly<Record<string, FigmaMatch>> | undefined
): Map<string, Matched> => {
  const own = code.filter((t) => t.own);
  const declared = new Set(own.map((t) => t.name));
  // A variable whose id changed (the file copied, a library published again) is found by place.
  const byPlace = new Map(
    Object.values(saved ?? {}).map((m) => [m.figma, m] as const)
  );
  const matched = new Map<string, Matched>();
  const open: FigmaSide[] = [];
  for (const token of figma) {
    const found = saved?.[matchKeyOf(token)] ?? byPlace.get(token.variable);
    if (found) {
      matched.set(token.variable, { by: found.by, to: found.to });
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
    figma
      .filter((t) => typeof matched.get(t.variable)?.to === "string")
      .map((t) => t.alias)
  );
  for (const token of figma) {
    if (!matched.has(token.variable) && pointedAt.has(token.variable)) {
      matched.set(token.variable, { by: "rule", to: null });
    }
  }
  return matched;
};

/**
 * Figma's tokens that have the value of exactly one code token of their kind, by `variable`:
 * where several come to one code token, the one that points at another takes it, if only one does.
 */
const matchByValue = (
  figma: readonly FigmaSide[],
  code: readonly SourceToken[]
): Map<string, string> => {
  const byTarget = new Map<string, FigmaSide[]>();
  for (const token of figma) {
    const same = code.filter(
      (t) => t.kind === token.kind && sameValue(token.values[""] ?? "", t.value)
    );
    const [target] = same;
    if (same.length === 1 && target) {
      byTarget.set(target.name, [...(byTarget.get(target.name) ?? []), token]);
    }
  }
  const found = new Map<string, string>();
  for (const [name, tokens] of byTarget) {
    const aliases = tokens.filter((t) => t.alias !== undefined);
    const [pick] = tokens.length === 1 ? tokens : aliases;
    if (pick && (tokens.length === 1 || aliases.length === 1)) {
      found.set(pick.variable, name);
    }
  }
  return found;
};

const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Why a Figma token cannot be matched to a code token of that name, or null when it can: the
 * name has to be one the code could declare, of the token's kind.
 */
export const matchProblem = (
  token: Pick<FigmaSide, "kind" | "variable">,
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

/**
 * What one token's value comes to, the source's against the design system's and the last
 * agreement's (ADR 0028).
 */
const outcomeOf = (
  source: string,
  design: string | undefined,
  base: { readonly code?: string; readonly source?: string } | null
): TokenOutcome => {
  if (design !== undefined && sameValue(source, design)) {
    return "same";
  }
  if (design === undefined) {
    // The design system took out what was agreed: the source is behind.
    return base?.code === undefined ? "to-design" : "source-behind";
  }
  if (base?.source === undefined) {
    return "conflict";
  }
  const sourceChanged = !sameValue(source, base.source);
  const designChanged = !sameValue(design, base.code);
  if (sourceChanged && !designChanged) {
    return "to-design";
  }
  if (designChanged && !sourceChanged) {
    return "source-behind";
  }
  return "conflict";
};

/**
 * A source's tokens against the design system's, theme by theme, against what was agreed last.
 * Only a matched token is compared: an unmatched one is listed and left alone.
 */
const compareSide = (
  side: readonly FigmaSide[],
  code: readonly SourceToken[],
  matches: ReadonlyMap<string, Matched>,
  baseOf: (
    name: string,
    theme: string,
    token: FigmaSide
  ) => { readonly code?: string; readonly source?: string } | null
): TokenDiff[] => {
  const declared = new Map(code.filter((t) => t.own).map((t) => [t.name, t]));
  return side.flatMap((token) =>
    Object.entries(token.values).map(([theme, value]): TokenDiff => {
      const match = matches.get(token.variable);
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
      if (match.to === null) {
        return {
          ...common,
          by: match.by,
          name: token.name,
          outcome: "ignored",
        };
      }
      const found = declared.get(match.to);
      const current = theme === "" ? found?.value : found?.values?.[theme];
      const base = baseOf(match.to, theme, token);
      return {
        ...common,
        ...(base?.source !== undefined && { base: base.source }),
        by: match.by,
        ...(current !== undefined && { design: current }),
        name: match.to,
        outcome: outcomeOf(value, current, base),
      };
    })
  );
};

/** Figma's tokens against the design system's, against the last sync with this file (ADR 0025). */
export const compareFigma = (
  figma: readonly FigmaSide[],
  code: readonly SourceToken[],
  baseline: SyncBaseline | null
): TokenDiff[] =>
  compareSide(
    figma,
    code,
    matchFigma(figma, code, baseline?.matches),
    (name, theme) => {
      const key = baselineKey(name, theme || undefined);
      return baseline
        ? { code: baseline.code[key], source: baseline.figma[key] }
        : null;
    }
  );

/** DESIGN.md's tokens as a source: one value each, in the default theme (ADR 0027). */
export const documentSide = (
  tokens: readonly {
    readonly alias?: string;
    readonly kind: SourceToken["kind"];
    readonly name: string;
    readonly value: string;
    readonly variable: string;
  }[]
): FigmaSide[] =>
  tokens.map((t) => ({
    ...(t.alias !== undefined && { alias: t.alias }),
    kind: t.kind,
    name: t.name,
    values: { "": t.value },
    variable: t.variable,
  }));

/** The matches DESIGN.md keeps, by path, as the matching reads them. */
const documentMatches = (
  baseline: DocumentBaseline | null
): Record<string, FigmaMatch> =>
  Object.fromEntries(
    Object.entries(baseline?.matches ?? {}).map(([variable, m]) => [
      variable,
      { by: m.by, figma: variable, to: m.to },
    ])
  );

/** What each of DESIGN.md's tokens is in the design system: the same rules as Figma's, by path. */
export const matchDocument = (
  side: readonly FigmaSide[],
  code: readonly SourceToken[],
  baseline: DocumentBaseline | null
) => matchFigma(side, code, documentMatches(baseline));

/**
 * DESIGN.md's tokens against the design system's. What the two agreed is one value by path: the
 * document's and the design system's were the same then.
 */
export const compareDocument = (
  side: readonly FigmaSide[],
  code: readonly SourceToken[],
  baseline: DocumentBaseline | null
): TokenDiff[] =>
  compareSide(
    side,
    code,
    matchDocument(side, code, baseline),
    (_name, _theme, token) => {
      const agreed = baseline?.agreed[token.variable];
      return agreed === undefined ? null : { code: agreed, source: agreed };
    }
  );

/**
 * The changes to the design system a comparison comes to once the user has picked: everything
 * the source changed alone, and the conflicts the user gave to it, in the design system's units.
 */
export const tokenChanges = (
  diffs: readonly TokenDiff[],
  decisions: readonly TokenDecision[]
): TokenChange[] => {
  const picked = new Map(
    decisions.map((d) => [baselineKey(d.name, d.theme), d.take])
  );
  // Two of the source's tokens matched to one code token: the first one's value is written.
  const changes = new Map<string, TokenChange>();
  for (const d of diffs) {
    const key = baselineKey(d.name, d.theme);
    const taken =
      d.outcome === "to-design" ||
      (d.outcome === "conflict" && picked.get(key) === "source");
    if (taken && d.source !== undefined && !changes.has(key)) {
      changes.set(key, {
        name: d.name,
        ...(d.theme && { theme: d.theme }),
        value: inCodeUnits(d.source, d.design),
      });
    }
  }
  return [...changes.values()];
};

/**
 * The design system with tokens the code was just given listed, so that DESIGN.md's front
 * matter, which mirrors what the design system lists, keeps them: a colour in the semantic group
 * (the first group when there is none), a radius and a spacing in theirs. `/sync describe` says
 * what each is for.
 */
export const listTokens = (
  ds: DesignSystem,
  tokens: readonly { readonly name: string; readonly value: string }[]
): DesignSystem => {
  const colors = tokens.filter((t) => t.name.startsWith("color-"));
  const radii = tokens.filter((t) => t.name.startsWith("radius-"));
  const spacing = tokens.filter((t) => t.name.startsWith("spacing-"));
  const semantic = Math.max(
    0,
    ds.colors.findIndex((g) => g.name.toLowerCase() === "semantic")
  );
  const into = () =>
    ds.colors.length === 0
      ? [{ name: "Colors", tokens: colors }]
      : ds.colors.map((g, i) =>
          i === semantic ? { ...g, tokens: [...g.tokens, ...colors] } : g
        );
  const groups = colors.length === 0 ? ds.colors : into();
  return {
    ...ds,
    colors: groups,
    radius: [...ds.radius, ...radii],
    spacing: {
      ...ds.spacing,
      ...(spacing.length > 0 && {
        tokens: [...(ds.spacing.tokens ?? []), ...spacing],
      }),
    },
  };
};

/**
 * The design system's tokens as a side to compare with: every token it lists, the spacing base
 * as `spacing`, each with its value per theme. A token whose value is empty is left out.
 */
export const designTokensOf = (ds: DesignSystem): SourceToken[] => {
  const tokens: SourceToken[] = [];
  const seen = new Set<string>();
  const add = (
    name: string,
    value: string,
    values?: Readonly<Record<string, string>>
  ) => {
    if (seen.has(name) || value === "") {
      return;
    }
    seen.add(name);
    tokens.push({
      kind: tokenKindOf(name),
      name,
      own: true,
      value,
      ...(values &&
        Object.keys(values).length > 0 && { values: { ...values } }),
    });
  };
  if (ds.spacing.base) {
    add("spacing", ds.spacing.base);
  }
  mapTokens(ds, (t) => {
    add(t.name, t.value, t.values);
    return t;
  });
  return tokens;
};

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

/**
 * The code's tokens against the design system's (ADR 0028), theme by theme, against what the two
 * last agreed on. Both sides name tokens the same way, so nothing is matched:
 * - only the design system has it: waiting for the code (`source-behind`);
 * - only the code has it: new there (`to-design`), unless the design system leaves it out on
 *   purpose (`ignored`), or took it out after they agreed (`conflict`);
 * - both: changed on one side since they agreed, that side's; on both, or never agreed, the
 *   user's pick.
 */
export const compareCode = (
  code: readonly SourceToken[],
  design: readonly SourceToken[],
  baseline: DocumentBaseline | null,
  omitted: ReadonlySet<string>
): TokenDiff[] => {
  const ours = valuesByKey(design);
  // A style system's own default counts as the code having the token, but is never offered.
  const theirs = valuesByKey(code);
  const own = valuesByKey(code.filter((t) => t.own));
  const kinds = new Map(
    [...code, ...design].map((t) => [t.name, t.kind] as const)
  );
  // The spacing base is the style system's step; a code that does not name it has the default.
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(own)])].filter(
    (key) => key !== "spacing" || key in theirs
  );
  return keys.sort().map((key): TokenDiff => {
    const at = key.indexOf("@");
    const name = at === -1 ? key : key.slice(0, at);
    const theme = at === -1 ? undefined : key.slice(at + 1);
    const designValue = ours[key];
    const codeValue = theirs[key];
    const base = baseline?.agreed[key];
    const common = {
      ...(base !== undefined && { base }),
      ...(designValue !== undefined && { design: designValue }),
      kind: kinds.get(name) ?? tokenKindOf(name),
      name,
      ...(codeValue !== undefined && { source: codeValue }),
      ...(theme && { theme }),
      variable: name,
    };
    return {
      ...common,
      outcome: codeOutcomeOf(designValue, codeValue, base, omitted.has(name)),
    };
  });
};

/** What one value of the code comes to against the design system's and their agreement. */
const codeOutcomeOf = (
  design: string | undefined,
  code: string | undefined,
  base: string | undefined,
  omitted: boolean
): TokenOutcome => {
  if (code === undefined) {
    return "source-behind";
  }
  if (design === undefined) {
    if (omitted) {
      return "ignored";
    }
    return base === undefined ? "to-design" : "conflict";
  }
  if (sameValue(code, design)) {
    return "same";
  }
  if (base === undefined) {
    return "conflict";
  }
  const codeChanged = !sameValue(code, base);
  const designChanged = !sameValue(design, base);
  if (codeChanged && !designChanged) {
    return "to-design";
  }
  if (designChanged && !codeChanged) {
    return "source-behind";
  }
  return "conflict";
};

/** How many of a code comparison's tokens wait for each side, and for the user. */
export const codeCounts = (diffs: readonly TokenDiff[]) => ({
  conflicts: diffs.filter((d) => d.outcome === "conflict").length,
  toCode: diffs.filter((d) => d.outcome === "source-behind").length,
  toDesign: diffs.filter((d) => d.outcome === "to-design").length,
});

/**
 * What a code comparison comes to once the user has picked (ADR 0028): the changes to the
 * design system (what the code changed alone, the conflicts given to the code) and to the code
 * (what the design system changed alone, the conflicts given to it), one direction only when
 * asked. A token the design system took out after they agreed, given to the design system, is
 * taken out of the code.
 */
export const codeChanges = (
  diffs: readonly TokenDiff[],
  decisions: readonly TokenDecision[],
  only?: "export" | "import"
): { readonly toCode: TokenChange[]; readonly toDesign: TokenChange[] } => {
  const picked = new Map(
    decisions.map((d) => [baselineKey(d.name, d.theme), d.take])
  );
  const toCode: TokenChange[] = [];
  const toDesign: TokenChange[] = [];
  for (const d of diffs) {
    const pick = picked.get(baselineKey(d.name, d.theme));
    const target = {
      name: d.name,
      ...(d.theme && { theme: d.theme }),
    };
    const importIt =
      d.outcome === "to-design" ||
      (d.outcome === "conflict" && pick === "source");
    const exportIt =
      d.outcome === "source-behind" ||
      (d.outcome === "conflict" && pick === "design");
    if (importIt && only !== "export" && d.source !== undefined) {
      toDesign.push({ ...target, value: d.source });
    }
    if (exportIt && only !== "import") {
      toCode.push(
        d.design === undefined
          ? { ...target, remove: true }
          : { ...target, value: d.design }
      );
    }
  }
  return { toCode, toDesign };
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

/**
 * A design system with token changes made to it: a value set where the token is listed, a token
 * not listed yet added where `listTokens` puts it (the default theme first), a removal taken out.
 */
export const withTokenChanges = (
  ds: DesignSystem,
  changes: readonly TokenChange[]
): DesignSystem => {
  const byName = new Map<string, TokenChange[]>();
  for (const c of changes) {
    byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  }
  let spacingBase = ds.spacing.base;
  const spacing = byName.get("spacing");
  for (const c of spacing ?? []) {
    if (c.theme === undefined && c.value !== undefined) {
      spacingBase = c.value;
    }
  }
  byName.delete("spacing");
  const listed = new Set(designSystemTokenNames(ds));
  const apply = (t: Token): Token => {
    const own = byName.get(t.name);
    if (!own) {
      return t;
    }
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
  const removed = new Set(
    changes.filter((c) => c.remove && c.theme === undefined).map((c) => c.name)
  );
  const changed = removeTokens(mapTokens(ds, apply), removed);
  const added = [...byName.entries()]
    .filter(([name]) => !(listed.has(name) || removed.has(name)))
    .flatMap(([name, own]) => {
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
      return [
        {
          name,
          value,
          ...(Object.keys(values).length > 0 && { values }),
        },
      ];
    });
  const withAdded = added.length > 0 ? listTokens(changed, added) : changed;
  return spacingBase === ds.spacing.base
    ? withAdded
    : { ...withAdded, spacing: { ...withAdded.spacing, base: spacingBase } };
};

/** A design system without the tokens of these names, wherever it lists them. */
const removeTokens = (
  ds: DesignSystem,
  names: ReadonlySet<string>
): DesignSystem => {
  if (names.size === 0) {
    return ds;
  }
  const keep = <T extends { readonly name: string }>(list: readonly T[]) =>
    list.filter((t) => !names.has(t.name));
  const optional = <T extends { readonly name: string }>(
    list: readonly T[] | undefined
  ) => (list === undefined ? undefined : keep(list));
  return {
    ...ds,
    ...(ds.borderWidths && { borderWidths: keep(ds.borderWidths) }),
    colors: ds.colors.map((g) => ({ ...g, tokens: keep(g.tokens) })),
    ...(ds.layout && {
      layout: {
        ...ds.layout,
        ...(ds.layout.breakpoints && {
          breakpoints: keep(ds.layout.breakpoints),
        }),
        ...(ds.layout.containers && { containers: keep(ds.layout.containers) }),
      },
    }),
    ...(ds.motion && {
      motion: {
        ...ds.motion,
        ...(ds.motion.durations && { durations: keep(ds.motion.durations) }),
        ...(ds.motion.easings && { easings: keep(ds.motion.easings) }),
        ...(ds.motion.animations && {
          animations: keep(ds.motion.animations),
        }),
      },
    }),
    radius: keep(ds.radius),
    shadows: keep(ds.shadows),
    spacing: {
      ...ds.spacing,
      ...(ds.spacing.tokens && { tokens: keep(ds.spacing.tokens) }),
    },
    typography: {
      ...ds.typography,
      fonts: keep(ds.typography.fonts),
      ...(ds.typography.leading && {
        leading: optional(ds.typography.leading),
      }),
      sizes: keep(ds.typography.sizes),
      ...(ds.typography.tracking && {
        tracking: optional(ds.typography.tracking),
      }),
      weights: keep(ds.typography.weights),
    },
  };
};
