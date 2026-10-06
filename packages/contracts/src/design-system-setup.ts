/**
 * Setting up a design system on an existing project, in steps the user sees, stops and redoes
 * (ADR 0023): an inventory of what the code uses, a design system defined from it, a mapping of
 * what is off the system, the migration of the code, and a last inventory to verify it.
 */
import { Schema } from "effect";
import type { DesignSystem } from "./design-system.ts";

export const SetupStepId = Schema.Literals([
  "inventory",
  "define",
  "map",
  "migrate",
  "verify",
]);
export type SetupStepId = typeof SetupStepId.Type;

/** The steps in their order, what each is called, and whether an agent does it. */
export const SETUP_STEPS: readonly {
  readonly agent: boolean;
  readonly id: SetupStepId;
  readonly description: string;
  readonly title: string;
}[] = [
  {
    agent: false,
    description:
      "Reads the code for the colours, spacing, type, radii, shadows, layers and plain elements it uses, and which of them are the design system's.",
    id: "inventory",
    title: "Inventory",
  },
  {
    agent: true,
    description:
      "An agent writes the design system: it adopts the theme there is, or proposes one from what the code uses, and asks you what to keep.",
    id: "define",
    title: "Define",
  },
  {
    agent: true,
    description:
      "Decides what each value off the system becomes: a token, a component, or kept as it is. Rules take the exact matches; an agent the rest, asking you where meaning is unclear.",
    id: "map",
    title: "Map",
  },
  {
    agent: true,
    description:
      "Brings the code onto the design system in batches, a directory at a time: the rules rewrite what the mapping settles, an agent the rest, and each batch can be undone on its own.",
    id: "migrate",
    title: "Migrate",
  },
  {
    agent: false,
    description:
      "Reads the code again against the design system and lists what is still off it.",
    id: "verify",
    title: "Verify",
  },
];

export const setupStepOf = (id: SetupStepId) =>
  SETUP_STEPS.find((s) => s.id === id) ?? SETUP_STEPS[0];

/**
 * - `todo`: not started.
 * - `active`: under way; for an agent's step, a thread works on it.
 * - `review`: finished by whoever ran it, waiting for the user to go on.
 * - `stopped`: the user stopped it; what it did so far is kept.
 * - `done`: the user went on past it.
 */
export const SetupStepStatus = Schema.Literals([
  "todo",
  "active",
  "review",
  "stopped",
  "done",
]);
export type SetupStepStatus = typeof SetupStepStatus.Type;

/** Adopt the theme there is as the design system, or propose one from what the code uses. */
export const DefineMode = Schema.Literals(["adopt", "propose"]);
export type DefineMode = typeof DefineMode.Type;

/**
 * A batch of the migration: the files of one directory (or part of one), rewritten together and
 * undone together.
 */
export const MigrationBatch = Schema.Struct({
  /** The working tree when the batch was finished. */
  after: Schema.optional(Schema.String),
  /** The working tree before the rules rewrote the batch. */
  before: Schema.optional(Schema.String),
  /** What the rules rewrote. */
  changes: Schema.optional(Schema.Number),
  dir: Schema.String,
  files: Schema.Array(Schema.String),
  id: Schema.String,
  status: Schema.Literals(["todo", "active", "done"]),
  summary: Schema.optional(Schema.String),
});
export type MigrationBatch = typeof MigrationBatch.Type;

export const SetupStep = Schema.Struct({
  /** The working tree when it stopped or was done: a git tree under `refs/ultrapaint/setup/`. */
  after: Schema.optional(Schema.String),
  /** Migrate's batches, in the order they are taken. */
  batches: Schema.optional(Schema.Array(MigrationBatch)),
  /** The working tree when it started. */
  before: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.Number),
  id: SetupStepId,
  mode: Schema.optional(DefineMode),
  startedAt: Schema.optional(Schema.Number),
  status: SetupStepStatus,
  /** What the step found or did, in a few lines, from the server or the agent. */
  summary: Schema.optional(Schema.String),
  /** The thread an agent's step runs in. */
  threadId: Schema.optional(Schema.String),
});
export type SetupStep = typeof SetupStep.Type;

export const DesignSystemSetup = Schema.Struct({
  /** Every step, in order. */
  steps: Schema.Array(SetupStep),
  updatedAt: Schema.Number,
});
export type DesignSystemSetup = typeof DesignSystemSetup.Type;

export const emptySetup = (at: number): DesignSystemSetup => ({
  steps: SETUP_STEPS.map((s) => ({ id: s.id, status: "todo" as const })),
  updatedAt: at,
});

/** What the inventory sorts values into. */
export const UsageKind = Schema.Literals([
  "color",
  "spacing",
  "fontSize",
  "fontWeight",
  "radius",
  "shadow",
  "zIndex",
  "element",
]);
export type UsageKind = typeof UsageKind.Type;

export const USAGE_KINDS: readonly {
  readonly kind: UsageKind;
  readonly label: string;
}[] = [
  { kind: "color", label: "Colours" },
  { kind: "spacing", label: "Spacing" },
  { kind: "fontSize", label: "Type sizes" },
  { kind: "fontWeight", label: "Weights" },
  { kind: "radius", label: "Radii" },
  { kind: "shadow", label: "Shadows" },
  { kind: "zIndex", label: "Layers" },
  { kind: "element", label: "Plain elements" },
];

/**
 * - `system`: a value of the design system (a token it names, a step of its scale).
 * - `default`: one of Tailwind's own values the design system does not name.
 * - `raw`: a value written out: a hex colour, an arbitrary class, an inline style, a plain
 *   element where the library has a component.
 */
export const UsageStatus = Schema.Literals(["system", "default", "raw"]);
export type UsageStatus = typeof UsageStatus.Type;

export const UsageLocation = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
});
export type UsageLocation = typeof UsageLocation.Type;

export const UsageValue = Schema.Struct({
  count: Schema.Number,
  /** How it is written, a few of the ways: `bg-[#3B82F6]`, `color: #3b82f6`. */
  examples: Schema.Array(Schema.String),
  files: Schema.Number,
  kind: UsageKind,
  /** The first places it is used. */
  locations: Schema.Array(UsageLocation),
  status: UsageStatus,
  /** The token it is, or that has exactly its value; the component for a plain element. */
  token: Schema.optional(Schema.String),
  /** What it is: a token name (`color-blue-500`), a literal (`#3b82f6`, `13px`), an element. */
  value: Schema.String,
});
export type UsageValue = typeof UsageValue.Type;

export const UsageTotals = Schema.Struct({
  default: Schema.Number,
  kind: UsageKind,
  raw: Schema.Number,
  system: Schema.Number,
});
export type UsageTotals = typeof UsageTotals.Type;

export const UsageInventory = Schema.Struct({
  /** Which design system it was read against: the one saved, or the theme's when none is. */
  against: Schema.Literals(["saved", "theme"]),
  at: Schema.Number,
  /** Source files read. */
  files: Schema.Number,
  /** The colour tokens the repository's own theme declares, not Tailwind's. */
  ownColors: Schema.Number,
  recommendation: Schema.Struct({ mode: DefineMode, reason: Schema.String }),
  totals: Schema.Array(UsageTotals),
  /** Most used first, the ones off the system before the rest; capped. */
  values: Schema.Array(UsageValue),
});
export type UsageInventory = typeof UsageInventory.Type;

/** What redoing a step does to a file. */
export const RestoreEntry = Schema.Struct({
  action: Schema.Literals(["restore", "delete"]),
  path: Schema.String,
});
export type RestoreEntry = typeof RestoreEntry.Type;

/**
 * What a value off the system becomes: a token of its kind (`color-primary`, `spacing-3`,
 * `radius-md`, `text-sm`, `font-weight-semibold`, `shadow-md`), a z-index the elevation names
 * (`50`), the component a plain element is replaced with (`Button`), or kept as it is. Neither a
 * target nor kept is undecided.
 */
export const MappingEntry = Schema.Struct({
  /** Who decided: a rule, the agent, the user. */
  by: Schema.optional(Schema.Literals(["rule", "agent", "user"])),
  count: Schema.Number,
  /** How it is written, once. */
  example: Schema.optional(Schema.String),
  keep: Schema.optional(Schema.Boolean),
  kind: UsageKind,
  /** Why, in a few words. */
  note: Schema.optional(Schema.String),
  status: UsageStatus,
  target: Schema.optional(Schema.String),
  value: Schema.String,
  /** Where it is used first, `src/app.tsx:12`. */
  where: Schema.optional(Schema.String),
});
export type MappingEntry = typeof MappingEntry.Type;

export const UsageMapping = Schema.Struct({
  at: Schema.Number,
  /** Most used first. */
  entries: Schema.Array(MappingEntry),
});
export type UsageMapping = typeof UsageMapping.Type;

/** A decision on one value: a target, kept, or neither to undecide it. */
export const MappingChange = Schema.Struct({
  keep: Schema.optional(Schema.Boolean),
  kind: UsageKind,
  note: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  value: Schema.String,
});
export type MappingChange = typeof MappingChange.Type;

/** How the mapping is looked up: a value by its kind. */
export const mappingKey = (kind: UsageKind, value: string) =>
  `${kind}|${value}`;

/** A use the rules left for the agent, and what the mapping says it becomes. */
export const UsageLeft = Schema.Struct({
  kind: UsageKind,
  line: Schema.Number,
  raw: Schema.String,
  /** Absent when the mapping has not decided it. */
  target: Schema.optional(Schema.String),
  value: Schema.String,
});
export type UsageLeft = typeof UsageLeft.Type;

/**
 * The targets a kind may take by name: its tokens, the layers, the components. A length may
 * also become a step of the spacing scale, which no list holds: any `spacing-<n>` is one.
 */
export const targetsOf = (
  kind: UsageKind,
  ds: DesignSystem,
  components: readonly string[]
): readonly string[] => {
  const names = (tokens: readonly { readonly name: string }[] | undefined) =>
    (tokens ?? []).map((t) => t.name);
  switch (kind) {
    case "color":
      return ds.colors.flatMap((g) => names(g.tokens));
    case "spacing":
      return names(ds.spacing.tokens);
    case "fontSize":
      return names(ds.typography.sizes);
    case "fontWeight":
      return names(ds.typography.weights);
    case "radius":
      return names(ds.radius);
    case "shadow":
      return names(ds.shadows);
    case "zIndex":
      return (ds.elevation ?? []).flatMap((l) =>
        l.layer === undefined ? [] : [String(l.layer)]
      );
    case "element":
      return components;
    default:
      return [];
  }
};
