/**
 * The sync's rules (ADR 0025), pure: which case a project is in, what drifted between the
 * design system and the code, and the steps that bring them together.
 */
import {
  type DesignSystem,
  designSystemTokenNames,
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
  type FigmaDecision,
  type FigmaTokenDiff,
  type FigmaTokenOutcome,
  type SyncBaseline,
  type SyncCase,
  type SyncDrift,
  type SyncFacts,
  type SyncStep,
  type SyncStepKind,
  type SyncStepState,
} from "@ultrapaint/contracts/sync";
import type { SourceToken, TokenChange } from "@ultrapaint/contracts/tokens";
import { inCodeUnits, sameValue } from "./token-values.ts";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

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
  /** Whether the stylesheets were read at all: without them every token would look gone. */
  read: boolean
): SyncDrift => {
  if (!ds) {
    return emptyDrift;
  }
  const omitted = new Set(ds.omitted ?? []);
  const listed = new Set(designSystemTokenNames(ds));
  const declared = new Set(tokens.map((t) => t.name));
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
    tokensGone: read
      ? [...listed].filter((t) => !(declared.has(t) || omitted.has(t)))
      : [],
    tokensUndescribed: tokens
      .filter((t) => t.own && !(listed.has(t.name) || omitted.has(t.name)))
      .map((t) => t.name),
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
    facts.libraryDirs.length > 0 && facts.components === 0
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
  return step(
    "figma-tokens",
    "Take the tokens from Figma",
    synced ? "done" : "attention",
    synced
      ? `${name ?? "The Figma file"} and the code agree.`
      : `The variables and styles of ${name ?? "the Figma file"}, compared with the code's tokens: what changed on one side is taken to the other; you pick where both changed.`
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

const describeStepOf = (drift: SyncDrift) => {
  const drifted = driftCount(drift) > 0;
  return step(
    "describe",
    "Describe what changed",
    drifted ? "attention" : "done",
    drifted
      ? `The code has ${driftParts(drift).join("; ")}. An agent updates the design system, asking you what each is for.`
      : "The design system lists every token and component the code has. Values are always read from the code."
  );
};

const stepsOf = (input: PlanInput): SyncStep[] => {
  const { drift, facts, figmaSynced, setup } = input;
  const kind = caseOf(facts);
  const figma = kind === "figma" || kind === "figma-code";
  const head = settingsSteps(facts);
  if (kind === "maintain") {
    return [
      ...head,
      describeStepOf(drift),
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
    "There is a Figma file and an application without a design system: Figma's tokens are brought onto the code.",
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

/** A token as Figma has it, named as the code names it (`@ultrapaint/figma-import/tokens`). */
export interface FigmaSide {
  readonly kind: SourceToken["kind"];
  readonly name: string;
  readonly values: Readonly<Record<string, string>>;
  readonly variable: string;
}

/** What one token's value comes to, Figma's against the code's and the last sync's. */
const outcomeOf = (
  figma: string,
  code: string | undefined,
  base: { readonly code?: string; readonly figma?: string } | null
): FigmaTokenOutcome => {
  if (code !== undefined && sameValue(figma, code)) {
    return "same";
  }
  if (code === undefined) {
    // The code took out what the last sync agreed on: Figma is behind.
    return base?.code === undefined ? "to-code" : "figma-behind";
  }
  if (base?.figma === undefined) {
    return "conflict";
  }
  const figmaChanged = !sameValue(figma, base.figma);
  const codeChanged = !sameValue(code, base.code);
  if (figmaChanged && !codeChanged) {
    return "to-code";
  }
  if (codeChanged && !figmaChanged) {
    return "figma-behind";
  }
  return "conflict";
};

/** Figma's tokens against the code's, theme by theme, against the last sync with this file. */
export const compareFigma = (
  figma: readonly FigmaSide[],
  code: readonly SourceToken[],
  baseline: SyncBaseline | null
): FigmaTokenDiff[] => {
  const declared = new Map(code.filter((t) => t.own).map((t) => [t.name, t]));
  return figma.flatMap((token) =>
    Object.entries(token.values).map(([theme, value]): FigmaTokenDiff => {
      const found = declared.get(token.name);
      const current = theme === "" ? found?.value : found?.values?.[theme];
      const key = baselineKey(token.name, theme || undefined);
      const base = baseline
        ? { code: baseline.code[key], figma: baseline.figma[key] }
        : null;
      return {
        ...(base?.figma !== undefined && { base: base.figma }),
        ...(current !== undefined && { code: current }),
        figma: value,
        kind: token.kind,
        name: token.name,
        outcome: outcomeOf(value, current, base),
        ...(theme && { theme }),
        variable: token.variable,
      };
    })
  );
};

/**
 * The changes to the code a comparison comes to once the user has picked: everything Figma
 * changed alone, and the conflicts the user gave to Figma, written in the code's units.
 */
export const figmaChanges = (
  diffs: readonly FigmaTokenDiff[],
  decisions: readonly FigmaDecision[]
): TokenChange[] => {
  const picked = new Map(
    decisions.map((d) => [baselineKey(d.name, d.theme), d.take])
  );
  return diffs
    .filter(
      (d) =>
        d.outcome === "to-code" ||
        (d.outcome === "conflict" &&
          picked.get(baselineKey(d.name, d.theme)) === "figma")
    )
    .map((d) => ({
      name: d.name,
      ...(d.theme && { theme: d.theme }),
      value: inCodeUnits(d.figma, d.code),
    }));
};
