/**
 * The design-system sync (ADR 0025): one action that reads what a project has — an application,
 * its components and tokens, a design system, Figma imports — works out which case it is in, and
 * lays out the steps that bring the design system and the code together. The steps are the
 * setup's (ADR 0023) where they apply; the rest are the sync's own.
 */
import { Schema } from "effect";
import { TokenKind } from "./tokens.ts";

/**
 * - `scratch`: no application yet.
 * - `code`: an application, no design system: it is made from the code.
 * - `figma`: a Figma import and no application: the application starts from Figma's tokens.
 * - `figma-code`: a Figma import and an application, no design system: Figma's tokens are
 *   brought onto the code.
 * - `maintain`: a design system and the code it describes, kept together.
 */
export const SyncCase = Schema.Literals([
  "scratch",
  "code",
  "figma",
  "figma-code",
  "maintain",
]);
export type SyncCase = typeof SyncCase.Type;

export const SyncStepKind = Schema.Literals([
  "settings",
  "scaffold",
  "figma-tokens",
  "inventory",
  "define",
  "map",
  "migrate",
  "verify",
  "describe",
  "import-frames",
]);
export type SyncStepKind = typeof SyncStepKind.Type;

/**
 * - `todo`: to do, in its turn.
 * - `attention`: to do now, or waiting for the user.
 * - `active`: under way.
 * - `done`: nothing left.
 */
export const SyncStepState = Schema.Literals([
  "todo",
  "attention",
  "active",
  "done",
]);
export type SyncStepState = typeof SyncStepState.Type;

export const SyncStep = Schema.Struct({
  /** What the step is about now, in a sentence. */
  detail: Schema.String,
  kind: SyncStepKind,
  /** Offered, not needed: the plan is complete without it. */
  optional: Schema.optional(Schema.Boolean),
  state: SyncStepState,
  title: Schema.String,
});
export type SyncStep = typeof SyncStep.Type;

/** A token or component one side has and the other does not describe or declare. */
export const SyncDrift = Schema.Struct({
  /** Components the design system notes that the code no longer has. */
  componentsGone: Schema.Array(Schema.String),
  /** Components of the code the design system says nothing about. */
  componentsUndescribed: Schema.Array(Schema.String),
  /** Tokens the design system lists that the code no longer declares. */
  tokensGone: Schema.Array(Schema.String),
  /** Tokens the code declares that the design system does not list. */
  tokensUndescribed: Schema.Array(Schema.String),
});
export type SyncDrift = typeof SyncDrift.Type;

export const emptyDrift: SyncDrift = {
  componentsGone: [],
  componentsUndescribed: [],
  tokensGone: [],
  tokensUndescribed: [],
};

/** How much drift there is, in one number: what the Design system tab counts. */
export const driftCount = (drift: SyncDrift) =>
  drift.componentsGone.length +
  drift.componentsUndescribed.length +
  drift.tokensGone.length +
  drift.tokensUndescribed.length;

export const SyncFacts = Schema.Struct({
  /** The package the pages resolve from has React: there is an application. */
  app: Schema.Boolean,
  /** Components the catalogue lists. */
  components: Schema.Number,
  /** Whether `design-system.json` is there and reads. */
  designSystem: Schema.Boolean,
  /** The newest Figma import, when there is one. */
  figma: Schema.optional(
    Schema.Struct({ id: Schema.String, name: Schema.String })
  ),
  /** The component directories the settings name. */
  libraryDirs: Schema.Array(Schema.String),
  styleSystem: Schema.String,
  /** The stylesheets the settings name. */
  stylesheets: Schema.Number,
  /** Tokens the code declares itself, not the style system's defaults. */
  tokens: Schema.Number,
});
export type SyncFacts = typeof SyncFacts.Type;

export const SyncPlan = Schema.Struct({
  at: Schema.Number,
  case: SyncCase,
  drift: SyncDrift,
  facts: SyncFacts,
  steps: Schema.Array(SyncStep),
  /** The case and what comes next, in a sentence or two. */
  summary: Schema.String,
});
export type SyncPlan = typeof SyncPlan.Type;

/**
 * What the last sync with Figma agreed on, kept in `design-system.json` so a teammate's sync
 * starts from the same point: each token's value in Figma and in the code then, keyed by
 * `name` for the default theme and `name@theme` for another.
 */
export const SyncBaseline = Schema.Struct({
  at: Schema.Number,
  code: Schema.Record(Schema.String, Schema.String),
  figma: Schema.Record(Schema.String, Schema.String),
  /** The Figma file it was taken from, by name. */
  file: Schema.String,
});
export type SyncBaseline = typeof SyncBaseline.Type;

/** The key a token's value is kept under in a baseline. */
export const baselineKey = (name: string, theme?: string) =>
  theme ? `${name}@${theme}` : name;

/**
 * What a token's comparison between Figma and the code comes to, against the baseline:
 * - `same`: nothing to do.
 * - `to-code`: Figma changed it (or has it and the code does not): the code takes Figma's.
 * - `figma-behind`: the code changed it since; Figma is behind, and the code is kept.
 * - `conflict`: both changed it, or there is no baseline and they differ: the user picks.
 */
export const FigmaTokenOutcome = Schema.Literals([
  "same",
  "to-code",
  "figma-behind",
  "conflict",
]);
export type FigmaTokenOutcome = typeof FigmaTokenOutcome.Type;

export const FigmaTokenDiff = Schema.Struct({
  base: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  figma: Schema.String,
  kind: TokenKind,
  /** The token, named as the code names it. */
  name: Schema.String,
  outcome: FigmaTokenOutcome,
  /** Left out for the default theme. */
  theme: Schema.optional(Schema.String),
  /** Where it came from in Figma: `Colors/Primary/500`. */
  variable: Schema.String,
});
export type FigmaTokenDiff = typeof FigmaTokenDiff.Type;

export const FigmaTokenComparison = Schema.Struct({
  /** Whether a baseline from this file was there to compare against. */
  baseline: Schema.Boolean,
  diffs: Schema.Array(FigmaTokenDiff),
  file: Schema.String,
  importId: Schema.String,
  /** What could not be read or named, in a few words each. */
  notes: Schema.Array(Schema.String),
});
export type FigmaTokenComparison = typeof FigmaTokenComparison.Type;

/** The user's pick for a token in conflict. */
export const FigmaDecision = Schema.Struct({
  name: Schema.String,
  take: Schema.Literals(["figma", "code"]),
  theme: Schema.optional(Schema.String),
});
export type FigmaDecision = typeof FigmaDecision.Type;
