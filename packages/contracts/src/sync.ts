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
  "code-tokens",
  "design-md",
  "design-tokens",
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
  /**
   * The design system against the code (ADR 0028), when there is a design system: tokens waiting
   * to be written to the code, changed in the code alone, and changed on both sides.
   */
  codeTokens: Schema.optional(
    Schema.Struct({
      conflicts: Schema.Number,
      toCode: Schema.Number,
      toDesign: Schema.Number,
    })
  ),
  /** Components the catalogue lists. */
  components: Schema.Number,
  /** `DESIGN.md`, when there is one (ADR 0027). */
  designMd: Schema.optional(
    Schema.Struct({
      /** Values of its front matter waiting for Sync: changed in it, or on both sides. */
      held: Schema.Number,
      /** In the designs directory, not at the root of the repository yet. */
      legacy: Schema.Boolean,
      path: Schema.String,
      /**
       * The format's sections it has with nothing under them; all eight when its prose is in
       * none of them (a DESIGN.md written before ADR 0027).
       */
      unwritten: Schema.Number,
    })
  ),
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
 * Where tokens come from to be compared with the design system's (ADR 0028): the newest Figma
 * import (ADR 0025), `DESIGN.md`'s front matter (ADR 0027), or the code.
 */
export const TokenSourceKind = Schema.Literals(["figma", "designMd", "code"]);
export type TokenSourceKind = typeof TokenSourceKind.Type;

/** Who matched a source's token to the code's: the rules, an agent, or the user. */
export const MatchSource = Schema.Literals(["rule", "agent", "user"]);
export type MatchSource = typeof MatchSource.Type;
export const FigmaMatchSource = MatchSource;
export type FigmaMatchSource = MatchSource;

/**
 * What a Figma variable or style is in the code: `to` the code's token, added when the code does
 * not declare it yet; null when it is left out of the code. A Figma file's names are rarely the
 * ones the code wants, so nothing of Figma's reaches the code before it is matched.
 */
export const FigmaMatch = Schema.Struct({
  by: FigmaMatchSource,
  /** Where it is in Figma, `Colors/Primary/500`: to read, and to find it by when ids differ. */
  figma: Schema.String,
  to: Schema.NullOr(Schema.String),
});
export type FigmaMatch = typeof FigmaMatch.Type;

/**
 * What the last sync with Figma agreed on, kept in `design-system.json` so a teammate's sync
 * starts from the same point: each token's value in Figma and in the design system then, keyed
 * by the design system's `name` for the default theme and `name@theme` for another, and what each
 * of Figma's tokens is in the design system. Matches saved before any value was taken leave `at`
 * at 0.
 */
export const SyncBaseline = Schema.Struct({
  at: Schema.Number,
  /**
   * The design system's values (ADR 0028). Called `code` because, before, the values were the
   * code's; the files already written keep the name.
   */
  code: Schema.Record(Schema.String, Schema.String),
  figma: Schema.Record(Schema.String, Schema.String),
  /** The Figma file it was taken from, by name. */
  file: Schema.String,
  /** What each Figma variable and style is in the code, by Figma's id. */
  matches: Schema.optional(Schema.Record(Schema.String, FigmaMatch)),
});
export type SyncBaseline = typeof SyncBaseline.Type;

/** The key a token's value is kept under in a baseline. */
export const baselineKey = (name: string, theme?: string) =>
  theme ? `${name}@${theme}` : name;

/**
 * What a token's comparison between a source (Figma, DESIGN.md, the code) and the design system
 * comes to, against what the two last agreed on (ADR 0028):
 * - `same`: nothing to do.
 * - `to-design`: the source changed it (or has it and the design system does not): the design
 *   system takes it.
 * - `source-behind`: the design system changed it since; the source is behind. For the code
 *   that is what an export writes; Figma and DESIGN.md are left as they are.
 * - `conflict`: both changed it, or nothing was agreed and they differ: the user picks.
 * - `unmatched`: no one has said what it is in the design system yet; nothing is written.
 * - `ignored`: left out of the design system on purpose.
 */
export const TokenOutcome = Schema.Literals([
  "same",
  "to-design",
  "source-behind",
  "conflict",
  "unmatched",
  "ignored",
]);
export type TokenOutcome = typeof TokenOutcome.Type;

export const TokenDiff = Schema.Struct({
  /** The source's token it points at, by `variable`: a semantic colour's palette entry. */
  alias: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  /** Who matched it; left out while it is unmatched. */
  by: Schema.optional(MatchSource),
  /** Its value in the design system; left out when the design system does not have it. */
  design: Schema.optional(Schema.String),
  kind: TokenKind,
  /**
   * The design system's token it is matched to; unmatched or left out, the name the source's own
   * naming comes to (`color-brand-500`).
   */
  name: Schema.String,
  outcome: TokenOutcome,
  /** Its value in the source; left out when the source does not have it (the code, behind). */
  source: Schema.optional(Schema.String),
  /** Left out for the default theme. */
  theme: Schema.optional(Schema.String),
  /** Where it came from in the source: `Colors/Primary/500`, `colors.primary`. */
  variable: Schema.String,
});
export type TokenDiff = typeof TokenDiff.Type;

export const TokenComparison = Schema.Struct({
  /** Whether an earlier agreement with this source was there to compare against. */
  baseline: Schema.Boolean,
  diffs: Schema.Array(TokenDiff),
  /** What the source is, to say: the Figma file's name, `DESIGN.md`. */
  file: Schema.String,
  /** The Figma import, for a Figma comparison. */
  importId: Schema.optional(Schema.String),
  /** What could not be read, named or compared, in a few words each. */
  notes: Schema.Array(Schema.String),
  source: TokenSourceKind,
  /** The design system's tokens, which the source's can be matched to. */
  targets: Schema.Array(
    Schema.Struct({ kind: TokenKind, name: Schema.String })
  ),
});
export type TokenComparison = typeof TokenComparison.Type;

/**
 * A source's token matched by an agent or the user, by where it is in the source: `to` the design
 * system's token (added when it does not have it), null to leave it out, absent to undo the match.
 */
export const TokenMatchInput = Schema.Struct({
  to: Schema.optional(Schema.NullOr(Schema.String)),
  variable: Schema.String,
});
export type TokenMatchInput = typeof TokenMatchInput.Type;

/** The user's pick for a token in conflict: the source's value or the design system's. */
export const TokenDecision = Schema.Struct({
  name: Schema.String,
  take: Schema.Literals(["source", "design"]),
  theme: Schema.optional(Schema.String),
});
export type TokenDecision = typeof TokenDecision.Type;
