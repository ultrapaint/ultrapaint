/**
 * The sync's plan (ADR 0025), pure: which case a project is in, what drifted between the design
 * system and the code, and the steps that bring them together. What each side is to the engine
 * is in `sync-readings.ts`.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignSystemSetup,
  SetupStepId,
  SetupStepStatus,
} from "@ultrapaint/contracts/design-system-setup";
import {
  driftCount,
  emptyDrift,
  type SyncCase,
  type SyncDrift,
  type SyncFacts,
  type SyncStep,
  type SyncStepKind,
  type SyncStepState,
  type TokenDiff,
} from "@ultrapaint/contracts/sync";
import { listedTokens } from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { SECTIONS } from "@ultrapaint/design-md/format";
import { plural } from "@ultrapaint/shared/text";

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

/** The settings step, when the settings point nowhere: no stylesheet. */
const settingsSteps = (facts: SyncFacts): SyncStep[] => {
  if (!facts.app) {
    return [];
  }
  const missing = [
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

/** How many of a code comparison's tokens wait for each side, and for the user. */
export const codeCounts = (diffs: readonly TokenDiff[]) => ({
  conflicts: diffs.filter((d) => d.outcome === "conflict").length,
  toCode: diffs.filter((d) => d.outcome === "source-behind").length,
  toDesign: diffs.filter((d) => d.outcome === "to-design").length,
});
