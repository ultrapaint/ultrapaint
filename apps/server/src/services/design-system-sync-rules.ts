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
  type FigmaMatch,
  type FigmaMatchSource,
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
import {
  type SourceToken,
  type TokenChange,
  tokenKindOf,
} from "@ultrapaint/contracts/tokens";
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
    "Match Figma's tokens to the code's",
    synced ? "done" : "attention",
    synced
      ? `${name ?? "The Figma file"} and the code agree on every token matched.`
      : `Each variable and style of ${name ?? "the Figma file"} is matched to a token of the code, added under a name you choose, or left out: rules take the plain matches, an agent the rest with you. Then what changed on one side is taken to the other, and you pick where both changed.`
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
        "DESIGN.md is the design system in the open format every agent reads, at the root of the repository: its front matter holds the tokens, kept in step with the code, and an agent describes the rest."
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
      ...documentSteps(facts),
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

/** A token as Figma has it, named as the code names it (`@ultrapaint/figma-import/tokens`). */
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

/** What a Figma token is in the code, and who said so. */
export interface Matched {
  readonly by: FigmaMatchSource;
  /** The code's token; null when it is left out. */
  readonly to: string | null;
}

/**
 * What each of Figma's tokens is in the code, by `variable` (ADR 0025). What an agent or the user
 * decided, kept in the baseline, comes first. Rules then take only what is certain: the code
 * declares a token of the same name, or exactly one token of the kind with the same value; when
 * several of Figma's come to one code token by value, the one that points at another (a semantic
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

/**
 * Figma's tokens against the code's, theme by theme, against the last sync with this file. Only
 * a matched token is compared: an unmatched one is listed and left alone.
 */
export const compareFigma = (
  figma: readonly FigmaSide[],
  code: readonly SourceToken[],
  baseline: SyncBaseline | null
): FigmaTokenDiff[] => {
  const declared = new Map(code.filter((t) => t.own).map((t) => [t.name, t]));
  const matches = matchFigma(figma, code, baseline?.matches);
  return figma.flatMap((token) =>
    Object.entries(token.values).map(([theme, value]): FigmaTokenDiff => {
      const match = matches.get(token.variable);
      const common = {
        ...(token.alias && { alias: token.alias }),
        figma: value,
        kind: token.kind,
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
      const key = baselineKey(match.to, theme || undefined);
      const base = baseline
        ? { code: baseline.code[key], figma: baseline.figma[key] }
        : null;
      return {
        ...common,
        ...(base?.figma !== undefined && { base: base.figma }),
        by: match.by,
        ...(current !== undefined && { code: current }),
        name: match.to,
        outcome: outcomeOf(value, current, base),
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
  // Two of Figma's tokens matched to one code token: the first one's value is written.
  const changes = new Map<string, TokenChange>();
  for (const d of diffs) {
    const key = baselineKey(d.name, d.theme);
    const taken =
      d.outcome === "to-code" ||
      (d.outcome === "conflict" && picked.get(key) === "figma");
    if (taken && !changes.has(key)) {
      changes.set(key, {
        name: d.name,
        ...(d.theme && { theme: d.theme }),
        value: inCodeUnits(d.figma, d.code),
      });
    }
  }
  return [...changes.values()];
};
