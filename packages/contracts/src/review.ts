/**
 * The review council (ADR 0060): the reviewers a design is reviewed by, and how what they find
 * becomes a score and a decision to go round again. Pure, so the lab (`evals`) and the editor
 * score a design the same way.
 *
 * - The **council** is the set of reviewers. It has no score of its own: each reviewer is scored
 *   on its own findings.
 * - A reviewer only looks. It finds problems; the designer fixes them.
 * - A finding names its **category**, one of the design skill's references, so a score, a
 *   finding, a gap and a rule share one name; and its **severity**, which sets what it costs.
 * - A category scores 100 less what its findings cost, never below 0. A section's overall is the
 *   mean of the categories it is scored on; a blocker caps it. A page's is the mean of its
 *   sections'. A reviewer that gave no review has **no score**: nothing is guessed for it.
 * - A **goal** says when to stop: every reviewer reaches its target score, or, with no score
 *   asked, every reviewer signs off; a safety cap ends a loop that isn't converging.
 * - **Who reviews each round** (ADR 0061): one member of the council, the members in turn, or all
 *   of them; and **who signs off** at the end: all of them, or the round's own reviewer.
 */
import { Schema } from "effect";

/**
 * The categories a finding is in: the design skill's references (`skills/ultrapaint/references/
 * <category>.md`), `picture` being how the design keeps to a picture it was given.
 */
export const CATEGORIES = [
  "hierarchy",
  "restraint",
  "layout",
  "spacing",
  "typography",
  "color",
  "elevation",
  "borders",
  "iconography",
  "motion",
  "content",
  "states",
  "usability",
  "components",
  "accessibility",
  "picture",
] as const;
export const Category = Schema.Literals(CATEGORIES);
export type Category = typeof Category.Type;

/** Scored on every section: every screen has them. The others, where the section has them. */
export const ALWAYS_SCORED: readonly Category[] = [
  "hierarchy",
  "restraint",
  "layout",
  "spacing",
  "typography",
  "color",
];

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;
export const Severity = Schema.Literals(SEVERITIES);
export type Severity = typeof Severity.Type;

/** What a finding of each severity takes off its category. */
export const PENALTY: Readonly<Record<Severity, number>> = {
  blocker: 40,
  major: 15,
  minor: 5,
  nit: 1,
};

/** The highest overall a section with a blocker can have. */
export const BLOCKER_CAP = 60;

/** One problem a reviewer found in a section. */
export const Finding = Schema.Struct({
  category: Category,
  fix: Schema.String,
  problem: Schema.String,
  /**
   * The skill's rule it breaks (`references/states.md › Before you finish › …`), or empty when
   * the skill has none: what tells a rule not applied from a rule missing.
   */
  rule: Schema.String,
  severity: Severity,
  title: Schema.String,
  where: Schema.String,
});
export type Finding = typeof Finding.Type;

/** A reviewer's word on a section: good enough for what was asked, or what is left. */
export const SignOff = Schema.Struct({
  done: Schema.Boolean,
  /** What is left before it would sign off; empty when done. */
  left: Schema.String,
});
export type SignOff = typeof SignOff.Type;

/** A score out of 100: overall and per category. */
export interface Scored {
  readonly categories: Readonly<Partial<Record<Category, number>>>;
  readonly kind: "scored";
  readonly overall: number;
}

/** A reviewer that gave no review: its score is not known, and none is made up. */
export interface NoScore {
  readonly kind: "none";
  readonly reason: string;
}

export type Score = NoScore | Scored;

const mean = (values: readonly number[]) =>
  values.reduce((n, v) => n + v, 0) / values.length;

/**
 * One section as one reviewer scored it: every category it is scored on (the ones every screen
 * has, the ones the reviewer says the section has, and any a finding is in) at 100 less its
 * findings' cost.
 */
export const sectionScore = (
  findings: readonly Finding[],
  reached: readonly Category[]
): Scored => {
  const scored = new Set<Category>([
    ...ALWAYS_SCORED,
    ...reached,
    ...findings.map((f) => f.category),
  ]);
  const categories: Partial<Record<Category, number>> = {};
  for (const category of CATEGORIES) {
    if (scored.has(category)) {
      const cost = findings
        .filter((f) => f.category === category)
        .reduce((n, f) => n + PENALTY[f.severity], 0);
      categories[category] = Math.max(0, 100 - cost);
    }
  }
  const overall = Math.round(mean(Object.values(categories)));
  const capped = findings.some((f) => f.severity === "blocker")
    ? Math.min(overall, BLOCKER_CAP)
    : overall;
  return { categories, kind: "scored", overall: capped };
};

/**
 * A page as one reviewer scored it, from its sections: each category the mean of the sections
 * scored on it, the overall the mean of theirs. A section it gave no review of is left out and
 * named; with none reviewed, it has no score.
 */
export const pageScore = (
  sections: readonly { readonly name: string; readonly score: Score }[]
): Score & { readonly unscored: readonly string[] } => {
  const scored = sections.flatMap((s) =>
    s.score.kind === "scored" ? [s.score] : []
  );
  const unscored = sections
    .filter((s) => s.score.kind === "none")
    .map((s) => s.name);
  if (scored.length === 0) {
    const reasons = sections.flatMap((s) =>
      s.score.kind === "none" ? [s.score.reason] : []
    );
    return {
      kind: "none",
      reason: [...new Set(reasons)].join("; ") || "nothing was reviewed",
      unscored,
    };
  }
  const categories: Partial<Record<Category, number>> = {};
  for (const category of CATEGORIES) {
    const values = scored.flatMap((s) => {
      const v = s.categories[category];
      return v === undefined ? [] : [v];
    });
    if (values.length > 0) {
      categories[category] = Math.round(mean(values));
    }
  }
  return {
    categories,
    kind: "scored",
    overall: Math.round(mean(scored.map((s) => s.overall))),
    unscored,
  };
};

/**
 * When the loop stops. Each reviewer's condition is its own entry in `reviewers` when it has
 * one, else `score`, else its sign-off:
 * - a number: its overall reaches it;
 * - `null`: it only advises, and never holds the loop up;
 * - nothing (no `score` either): it signs off.
 *
 * `floors` hold for every reviewer that isn't only advising. The caps end the loop whatever the
 * reviewers say.
 */
export const Goal = Schema.Struct({
  /** Spent across the rounds (where the models say what they cost) past which it stops. */
  budgetUsd: Schema.optional(Schema.Number),
  /** The lowest score a category may have, by the category's name. */
  floors: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  /** Rounds at most (`MAX_ROUNDS`). */
  maxRounds: Schema.optional(Schema.Number),
  /** Rounds without `PLATEAU.points` of gain before it stops (`PLATEAU.rounds`). */
  plateauRounds: Schema.optional(Schema.Number),
  /** Per reviewer, by its model's name: a target of its own, or `null` to only advise. */
  reviewers: Schema.optional(
    Schema.Record(Schema.String, Schema.NullOr(Schema.Number))
  ),
  /** The overall every reviewer reaches; absent, each signs off. */
  score: Schema.optional(Schema.Number),
});
export type Goal = typeof Goal.Type;

/** The safety cap on rounds, when the goal sets none. */
export const MAX_ROUNDS = 6;

/** Fewer points than this over this many rounds is no gain. */
export const PLATEAU = { points: 2, rounds: 2 } as const;

/** One reviewer in one round: its score of the page and whether it signed off every section. */
export interface ReviewerRound {
  readonly score: Score;
  readonly signedOff: boolean;
}

/** One round of the loop: every reviewer's result, and what the round cost where known. */
export interface Round {
  readonly costUsd: number;
  readonly reviewers: Readonly<Record<string, ReviewerRound>>;
}

/** What a reviewer is held to. */
export type Target =
  | { readonly kind: "advisory" }
  | { readonly kind: "score"; readonly score: number }
  | { readonly kind: "sign-off" };

export const targetOf = (goal: Goal, reviewer: string): Target => {
  const own = goal.reviewers?.[reviewer];
  if (own === null) {
    return { kind: "advisory" };
  }
  const score = own ?? goal.score;
  return score === undefined ? { kind: "sign-off" } : { kind: "score", score };
};

/** Why a reviewer isn't satisfied yet, or nothing when it is. */
const unmet = (
  goal: Goal,
  reviewer: string,
  result: ReviewerRound
): string | undefined => {
  const target = targetOf(goal, reviewer);
  if (target.kind === "advisory" || result.score.kind === "none") {
    return;
  }
  const { score } = result;
  if (target.kind === "score" && score.overall < target.score) {
    return `${reviewer} ${score.overall} < ${target.score}`;
  }
  if (target.kind === "sign-off" && !result.signedOff) {
    return `${reviewer} hasn't signed off`;
  }
  const low = Object.entries(goal.floors ?? {}).flatMap(([category, floor]) => {
    const v = score.categories[category as Category];
    return v !== undefined && floor !== undefined && v < floor
      ? [`${category} ${v} < ${floor}`]
      : [];
  });
  return low.length > 0 ? `${reviewer}: ${low.join(", ")}` : undefined;
};

/** A round's progress: the mean overall of the reviewers that scored it. */
export const progressOf = (round: Round): number | undefined => {
  const overalls = Object.values(round.reviewers).flatMap((r) =>
    r.score.kind === "scored" ? [r.score.overall] : []
  );
  return overalls.length === 0 ? undefined : mean(overalls);
};

/** The round with the best progress, the later of a tie; the first when none scored. */
export const bestRoundOf = (rounds: readonly Round[]): number => {
  let best = 0;
  let bestProgress = Number.NEGATIVE_INFINITY;
  rounds.forEach((round, i) => {
    const progress = progressOf(round);
    if (progress !== undefined && progress >= bestProgress) {
      best = i;
      bestProgress = progress;
    }
  });
  return best;
};

export type StopReason =
  | "budget"
  | "goal"
  | "max-rounds"
  | "no-scores"
  | "plateau"
  | "signed-off";

export type Verdict =
  | {
      /** The round to keep, by its index: not always the last. */
      readonly best: number;
      readonly reason: StopReason;
      readonly stop: true;
      /** Who was still short when a cap stopped it. */
      readonly unmet: readonly string[];
    }
  | { readonly stop: false; readonly unmet: readonly string[] };

/** Whether to stop after the last of `rounds`, and why. */
export const verdictOf = (goal: Goal, rounds: readonly Round[]): Verdict => {
  const last = rounds.at(-1);
  if (last === undefined) {
    return { stop: false, unmet: [] };
  }
  const best = bestRoundOf(rounds);
  const entries = Object.entries(last.reviewers);
  const unscored = ([, r]: (typeof entries)[number]) => r.score.kind === "none";
  const holding = entries.filter(
    ([name]) => targetOf(goal, name).kind !== "advisory"
  );
  // Nobody the goal holds to could say: the loop can't tell, so it stops rather than guess.
  if (
    entries.every(unscored) ||
    (holding.length > 0 && holding.every(unscored))
  ) {
    return { best, reason: "no-scores", stop: true, unmet: [] };
  }
  const short = entries.flatMap(([name, r]) => {
    const why = unmet(goal, name, r);
    return why === undefined ? [] : [why];
  });
  if (short.length === 0) {
    const anyScore = entries.some(
      ([name]) => targetOf(goal, name).kind === "score"
    );
    return {
      best: rounds.length - 1,
      reason: anyScore ? "goal" : "signed-off",
      stop: true,
      unmet: [],
    };
  }
  const spent = rounds.reduce((n, r) => n + r.costUsd, 0);
  if (goal.budgetUsd !== undefined && spent >= goal.budgetUsd) {
    return { best, reason: "budget", stop: true, unmet: short };
  }
  if (rounds.length >= (goal.maxRounds ?? MAX_ROUNDS)) {
    return { best, reason: "max-rounds", stop: true, unmet: short };
  }
  // A reviewer is compared with itself: with members in turn, rounds of other reviewers are left out.
  const same = sameReviewers(rounds, last);
  const span = goal.plateauRounds ?? PLATEAU.rounds;
  if (same.length > span) {
    const now = progressOf(last);
    const then = progressOf(same.at(-1 - span) as Round);
    if (
      now !== undefined &&
      then !== undefined &&
      now - then < PLATEAU.points
    ) {
      return { best, reason: "plateau", stop: true, unmet: short };
    }
  }
  return { stop: false, unmet: short };
};

/**
 * One finding as the findings log keeps it (`~/.ultrapaint/findings/<project>.jsonl`, opt-in):
 * where it was, who found it with which skill, and what the designer did, for triage to turn
 * recurring ones into gaps (issue #8).
 */
export const LoggedFinding = Schema.Struct({
  ...Finding.fields,
  /** The other reviewers that found the same problem. */
  agreedBy: Schema.Array(Schema.String),
  at: Schema.String,
  /** The section's picture the reviewer saw, an absolute path. */
  crop: Schema.optional(Schema.String),
  designer: Schema.Struct({
    did: Schema.Literals(["fixed", "declined", "unanswered"]),
    reason: Schema.optional(Schema.String),
  }),
  page: Schema.String,
  project: Schema.String,
  reviewer: Schema.String,
  round: Schema.Number,
  section: Schema.String,
  /** The skill's version: the commit the reviewer read it at. */
  skill: Schema.String,
});
export type LoggedFinding = typeof LoggedFinding.Type;

/** The rounds reviewed by the same reviewers as `last`, in order, `last` among them. */
const sameReviewers = (rounds: readonly Round[], last: Round) => {
  const key = Object.keys(last.reviewers).sort().join(",");
  return rounds.filter(
    (r) => Object.keys(r.reviewers).sort().join(",") === key
  );
};

/** Who reviews each round while the designer works: the first member, the members in turn, all. */
export const EACH_ROUND = ["one", "rotate", "all"] as const;
export type EachRound = (typeof EACH_ROUND)[number];

/** Who must reach the goal at the end: every member of the council, or the last round's reviewer. */
export const SIGN_OFF = ["all", "one"] as const;
export type SignOffBy = (typeof SIGN_OFF)[number];

/**
 * How a design is reviewed (ADR 0060, 0061): the council, who of it looks each round, who signs
 * off, the goal, when in the loop, and whether findings are logged. Kept per user and per project,
 * chosen again when a design starts and in its request; the narrower wins (run, project, user).
 */
export const ReviewSettings = Schema.Struct({
  /** The council: the reviewers, by model (`opus`, `gpt-6.1-sol`, `cursor:grok-4.7-high`). */
  council: Schema.optional(Schema.Array(Schema.String)),
  eachRound: Schema.optional(Schema.Literals(EACH_ROUND)),
  /** Whether each round's findings go to the findings log (`~/.ultrapaint/findings/`). */
  findingsLog: Schema.optional(Schema.Boolean),
  goal: Schema.optional(Goal),
  /** Whether reviews run at all. On when absent. */
  on: Schema.optional(Schema.Boolean),
  signOff: Schema.optional(Schema.Literals(SIGN_OFF)),
  /** After the designer's turn, or after each section it builds. */
  when: Schema.optional(Schema.Literals(["end", "each-section"])),
});
export type ReviewSettings = typeof ReviewSettings.Type;

/** What a review runs with when nothing says otherwise. */
export const DEFAULT_REVIEW = {
  eachRound: "rotate",
  findingsLog: false,
  on: true,
  signOff: "all",
  when: "end",
} as const satisfies ReviewSettings;

/** The settings of the narrowest layer that sets each field: the run's over the project's over the user's. */
export const reviewSettingsOf = (
  ...layers: readonly (ReviewSettings | undefined)[]
): ReviewSettings => {
  const merged: Record<string, unknown> = { ...DEFAULT_REVIEW };
  for (const layer of layers) {
    for (const [field, value] of Object.entries(layer ?? {})) {
      if (value !== undefined) {
        merged[field] = value;
      }
    }
  }
  return merged as ReviewSettings;
};

/** The members of the council who review round `index` (from 0) while the designer works. */
export const reviewersOfRound = (
  council: readonly string[],
  eachRound: EachRound,
  index: number
): readonly string[] => {
  if (council.length === 0 || eachRound === "all") {
    return council;
  }
  if (eachRound === "one") {
    return council.slice(0, 1);
  }
  const member = council[index % council.length];
  return member === undefined ? [] : [member];
};
