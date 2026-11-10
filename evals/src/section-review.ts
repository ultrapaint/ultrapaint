/**
 * One section of a design reviewed by fresh reviewers, each with the design skill, and their
 * findings merged: what the review loop of a round sends back to the designer (ADR 0060), and what
 * the panel counts in a finished design.
 *
 * A reviewer reads the skill (`SKILL.md` and the references it routes to) from a tree written for
 * an agent without the editor's tools, looks at the section's picture and the page's file, and
 * lists every problem. It reviews within the designer's request: the brief's content is used as
 * written, a picture given decides the look, and the components are the design system's; what
 * only a system component would fix comes apart, as a system note. Several reviewers' findings on
 * one section are grouped by the judge model, one problem per thing wrong, each keeping which
 * reviewers found it.
 *
 * A review also says what it rests on, so a concern skipped or a bad capture is seen, not taken
 * for a clean one: whether the picture could be judged at all (a review of a blank or half-drawn
 * capture is no review), a row per concern (passed, findings, or not reviewed and why), and one
 * thing the section does well, which the designer is told to keep. A reviewer approves a section
 * when it signs off and nothing a careful designer wouldn't ship is among its own findings: the
 * approval is taken from the findings, not from the word alone.
 */
import path from "node:path";
import {
  CATEGORIES,
  Category,
  Finding,
  pageScore,
  type ReviewerRound,
  type Score,
  SEVERITIES,
  SignOff,
  sectionScore,
} from "@ultrapaint/contracts/review";
import { Clock, Effect, Schema } from "effect";
import { EvalsError } from "./errors.ts";
import { prompt } from "./layout.ts";
import { Models } from "./models.ts";

/** One problem a reviewer found: its category and severity set what it costs (contracts' `review`). */
export const SectionFinding = Finding;
export type SectionFinding = Finding;

const str = { type: "string" };
const findingSchema = {
  additionalProperties: false,
  properties: {
    category: { enum: [...CATEGORIES], type: "string" },
    fix: str,
    problem: str,
    rule: str,
    severity: { enum: [...SEVERITIES], type: "string" },
    title: str,
    where: str,
  },
  required: [
    "title",
    "where",
    "problem",
    "fix",
    "category",
    "severity",
    "rule",
  ],
  type: "object",
};

/** What only a change to one of the design system's components would fix: not the designer's. */
export const SystemNote = Schema.Struct({
  component: Schema.String,
  note: Schema.String,
});
export type SystemNote = typeof SystemNote.Type;

export const COVERAGE = ["passed", "findings", "not reviewed"] as const;
/** What a review says of one concern: looked at and fine, looked at and wrong, or not looked at. */
export const CoverageRow = Schema.Struct({
  category: Category,
  /** Why it was not reviewed; empty otherwise. */
  note: Schema.String,
  verdict: Schema.Literals(COVERAGE),
});
export type CoverageRow = typeof CoverageRow.Type;

/** The concerns every screen has: a review answers for each, and for those it reached. */
const ALWAYS: readonly Category[] = [
  "hierarchy",
  "restraint",
  "layout",
  "spacing",
  "typography",
  "color",
];

/**
 * A review's coverage as it stands: a row for every concern the section has, a concern with
 * findings said to have them whatever its row says, and one the review gave no row said not
 * reviewed.
 */
export const coverageOf = (review: {
  readonly coverage?: readonly CoverageRow[] | undefined;
  readonly findings: readonly SectionFinding[];
  readonly reached: readonly Category[];
}): readonly CoverageRow[] => {
  const found = new Set(review.findings.map((f) => f.category));
  const has = new Set<Category>([...ALWAYS, ...review.reached, ...found]);
  return CATEGORIES.filter((category) => has.has(category)).map((category) => {
    if (found.has(category)) {
      return { category, note: "", verdict: "findings" };
    }
    const row = review.coverage?.find((r) => r.category === category);
    if (row === undefined) {
      return {
        category,
        note: "the review said nothing of it",
        verdict: "not reviewed",
      };
    }
    // A row that claims findings it does not give is a concern looked at with nothing to show.
    return row.verdict === "findings"
      ? { category, note: "", verdict: "passed" }
      : row;
  });
};

/** Whether a review approves its section: it signed off, and none of its findings holds it back. */
export const approves = (review: {
  readonly findings: readonly SectionFinding[];
  readonly signOff: SignOff;
}) =>
  review.signOff.done &&
  !review.findings.some(
    (f) => f.severity === "blocker" || f.severity === "major"
  );

const ReviewAnswer = Schema.Struct({
  /** A row per concern; absent in answers from before it was asked. */
  coverage: Schema.optional(Schema.Array(CoverageRow)),
  findings: Schema.Array(SectionFinding),
  /** One thing the section does well, which a fix must not undo; empty when it names none. */
  keep: Schema.optional(Schema.String),
  /** Whether the picture can be judged: not blank, drawn to the end, the section it is said to be. */
  picture: Schema.optional(
    Schema.Struct({ judged: Schema.Boolean, why: Schema.String })
  ),
  /** The categories, beyond the ones every screen has, the section has: what it is scored on. */
  reached: Schema.Array(Category),
  signOff: SignOff,
  systemNotes: Schema.Array(SystemNote),
});
const reviewAnswer = {
  decode: ReviewAnswer,
  schema: {
    additionalProperties: false,
    properties: {
      coverage: {
        items: {
          additionalProperties: false,
          properties: {
            category: { enum: [...CATEGORIES], type: "string" },
            note: str,
            verdict: { enum: [...COVERAGE], type: "string" },
          },
          required: ["category", "verdict", "note"],
          type: "object",
        },
        type: "array",
      },
      findings: { items: findingSchema, type: "array" },
      keep: str,
      picture: {
        additionalProperties: false,
        properties: { judged: { type: "boolean" }, why: str },
        required: ["judged", "why"],
        type: "object",
      },
      reached: {
        items: { enum: [...CATEGORIES], type: "string" },
        type: "array",
      },
      signOff: {
        additionalProperties: false,
        properties: { done: { type: "boolean" }, left: str },
        required: ["done", "left"],
        type: "object",
      },
      systemNotes: {
        items: {
          additionalProperties: false,
          properties: { component: str, note: str },
          required: ["component", "note"],
          type: "object",
        },
        type: "array",
      },
    },
    required: [
      "picture",
      "findings",
      "coverage",
      "reached",
      "keep",
      "signOff",
      "systemNotes",
    ],
    type: "object",
  },
};

/** What the designer was asked, which a reviewer keeps to. */
export interface ReviewRequest {
  /** The brief's text: its content is used as written. */
  readonly brief: string;
  /** The pictures the designer was given, absolute paths; they decide the look. None without. */
  readonly pictures: readonly string[];
}

/** The request as the review prompt tells it, the pictures named from `cwd`. */
const requestText = (request: ReviewRequest | undefined, cwd: string) =>
  request === undefined
    ? Effect.succeed("")
    : prompt("review-request", {
        brief: request.brief.trim(),
        picture:
          request.pictures.length === 0
            ? ""
            : `- The designer was given pictures of the screen to make (${request.pictures.map((p) => `\`${path.relative(cwd, p)}\``).join(", ")}), and they decide the look: where the section is as the pictures show (a layout, a fill, a border, a shadow, a size, a style), that is not a finding; where it differs from them, it is.\n`,
      });

const GroupAnswer = Schema.Struct({
  problems: Schema.Array(
    Schema.Struct({
      ...SectionFinding.fields,
      /** The labels of the findings it groups. */
      findings: Schema.Array(Schema.String),
    })
  ),
});
type GroupAnswer = typeof GroupAnswer.Type;
const groupAnswer = {
  decode: GroupAnswer,
  schema: {
    additionalProperties: false,
    properties: {
      problems: {
        items: {
          additionalProperties: false,
          properties: {
            ...findingSchema.properties,
            findings: { items: str, type: "array" },
          },
          required: [...findingSchema.required, "findings"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["problems"],
    type: "object",
  },
};

/** A section as a reviewer is shown it. */
export interface SectionToReview {
  readonly name: string;
  /** The page's node that holds it, when the designer named one. */
  readonly node?: string | undefined;
  /**
   * The directory of the page's files as they were when the picture was taken, for the values it
   * does not show.
   */
  readonly pages?: string | undefined;
  /** The section's picture, an absolute path. */
  readonly picture: string;
  /** What the section is for, in words that do not say what is wrong with it. */
  readonly where: string;
}

/** What one reviewer found in one section, and what it took. */
export interface SectionReview {
  readonly costUsd: number;
  /** A row per concern the section has (`coverageOf`); absent in a review that failed. */
  readonly coverage?: readonly CoverageRow[];
  /** Why the reviewer gave no review, when it gave none: it then has no score, and nothing else. */
  readonly failed?: string;
  readonly findings: readonly SectionFinding[];
  /** One thing the section does well, for the designer to keep. */
  readonly keep?: string;
  readonly reached: readonly Category[];
  readonly reviewer: string;
  readonly seconds: number;
  readonly section: string;
  readonly signOff: SignOff;
  readonly systemNotes: readonly SystemNote[];
  readonly tokens: number;
}

/** One problem of a section, with the reviewers that found it. */
export interface MergedFinding extends SectionFinding {
  readonly reviewers: readonly string[];
  readonly section: string;
}

export interface ReviewSettings {
  readonly effort: string;
  /** The model that groups several reviewers' findings. */
  readonly judgeModel: string;
  /** What the designer was asked; without it, the reviewer reviews the section on its own. */
  readonly request?: ReviewRequest | undefined;
  /** The skill's tree the reviewers read (`writeSkillTree`). */
  readonly tree: string;
}

/** What a step of reviewing cost: models' dollars and tokens, and the time it took. */
export interface Spent {
  readonly costUsd: number;
  readonly seconds: number;
  readonly tokens: number;
}

/** One reviewer's review of one section. */
export const reviewSection = Effect.fn("reviewSection")(function* (
  section: SectionToReview,
  reviewer: string,
  settings: ReviewSettings
) {
  const models = yield* Models;
  const started = yield* Clock.currentTimeMillis;
  const pageLine =
    section.pages === undefined
      ? ""
      : `The page's files as they were then are in \`${section.pages}\`, for the values, states and words the picture does not show${section.node === undefined ? "" : `; the section is the node \`${section.node}\``}.`;
  const cwd = path.dirname(section.picture);
  const pictures = settings.request?.pictures ?? [];
  const answer = yield* models.ask({
    cwd,
    dirs: [
      settings.tree,
      ...(section.pages === undefined ? [] : [section.pages]),
      ...new Set(pictures.map((p) => path.dirname(p))),
    ],
    effort: settings.effort,
    images: [
      path.basename(section.picture),
      ...pictures.map((p) => path.relative(cwd, p)),
    ],
    model: reviewer,
    prompt: yield* prompt("review-section", {
      name: section.name,
      page: pageLine,
      picture: path.basename(section.picture),
      request: yield* requestText(settings.request, cwd),
      skill: settings.tree,
      where: section.where,
    }),
    ...reviewAnswer,
  });
  const { picture } = answer.value;
  if (picture !== undefined && !picture.judged) {
    // A capture that can't be judged gives no review: no findings, no score, nothing signed off.
    return yield* new EvalsError({
      message: `it could not judge the picture: ${picture.why.trim() || "no reason given"}`,
    });
  }
  const keep = answer.value.keep?.trim();
  const review: SectionReview = {
    costUsd: answer.costUsd,
    coverage: coverageOf(answer.value),
    findings: answer.value.findings,
    ...(keep ? { keep } : {}),
    reached: answer.value.reached,
    reviewer,
    seconds: ((yield* Clock.currentTimeMillis) - started) / 1000,
    section: section.name,
    signOff: answer.value.signOff,
    systemNotes: answer.value.systemNotes,
    tokens: answer.tokens,
  };
  return review;
});

/**
 * Every reviewer's review of every section, several at once. A reviewer that fails (it timed out,
 * its answer didn't decode) gives no review of that section: the others go on, and it has no score
 * there rather than a made-up one.
 */
export const reviewSections = (
  sections: readonly SectionToReview[],
  reviewers: readonly string[],
  settings: ReviewSettings & { readonly concurrency: number }
) =>
  Effect.forEach(
    sections.flatMap((section) =>
      reviewers.map((reviewer) => ({ reviewer, section }))
    ),
    ({ reviewer, section }) =>
      reviewSection(section, reviewer, settings).pipe(
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(
            Effect.logWarning(
              `${reviewer} gave no review of ${section.name}: ${error.message}`
            ),
            {
              costUsd: 0,
              failed: error.message,
              findings: [],
              reached: [],
              reviewer,
              seconds: 0,
              section: section.name,
              signOff: { done: false, left: "" },
              systemNotes: [],
              tokens: 0,
            } satisfies SectionReview
          )
        )
      ),
    { concurrency: settings.concurrency }
  );

/** One reviewer's review of one section as a score: none when it gave no review. */
export const scoreOfReview = (review: SectionReview): Score =>
  review.failed === undefined
    ? sectionScore(review.findings, review.reached)
    : { kind: "none", reason: review.failed };

/**
 * Each reviewer's result for a round of reviews: its score of the page from the sections it
 * reviewed, and whether it signed off every one of them.
 */
export const reviewerRounds = (
  reviewers: readonly string[],
  reviews: readonly SectionReview[]
): Record<string, ReviewerRound & { readonly unscored: readonly string[] }> =>
  Object.fromEntries(
    reviewers.map((reviewer) => {
      const own = reviews.filter((r) => r.reviewer === reviewer);
      const given = own.filter((r) => r.failed === undefined);
      const { unscored, ...score } = pageScore(
        own.map((r) => ({ name: r.section, score: scoreOfReview(r) }))
      );
      return [
        reviewer,
        {
          score: score as Score,
          signedOff: given.length > 0 && given.every(approves),
          unscored,
        },
      ];
    })
  );

/** A finding under its label, as the grouping model is shown it. */
const listed = (label: string, f: SectionFinding) =>
  `${label}. **${f.title}** (${f.where}; ${f.category}, ${f.severity}): ${f.problem} Fix: ${f.fix}${f.rule === "" ? "" : ` Rule: ${f.rule}`}`;

/**
 * The problems the grouping model made of the labelled findings, each with the reviewers whose
 * findings it groups. A finding it left out of every problem is a problem of its own.
 */
export const mergedFrom = (
  section: string,
  labelled: readonly {
    readonly finding: SectionFinding;
    readonly label: string;
    readonly reviewer: string;
  }[],
  problems: GroupAnswer["problems"]
): readonly MergedFinding[] => {
  const byLabel = new Map(labelled.map((l) => [l.label, l]));
  const placed = new Set<string>();
  const merged = problems.flatMap((p) => {
    const found = p.findings.flatMap((l) => {
      const at = byLabel.get(l);
      return at === undefined || placed.has(l) ? [] : [at];
    });
    for (const at of found) {
      placed.add(at.label);
    }
    if (found.length === 0) {
      return [];
    }
    return [
      {
        category: p.category,
        fix: p.fix,
        problem: p.problem,
        reviewers: [...new Set(found.map((f) => f.reviewer))].sort(),
        rule: p.rule,
        section,
        severity: p.severity,
        title: p.title,
        where: p.where,
      },
    ];
  });
  const left = labelled
    .filter((l) => !placed.has(l.label))
    .map((l) => ({ ...l.finding, reviewers: [l.reviewer], section }));
  return [...merged, ...left];
};

/**
 * One section's reviews merged into its problems: grouped by the judge model when more than one
 * reviewer found something, else each finding as it is.
 */
export const mergeSection = Effect.fn("mergeSection")(function* (
  section: SectionToReview,
  reviews: readonly SectionReview[],
  settings: ReviewSettings
) {
  const models = yield* Models;
  const started = yield* Clock.currentTimeMillis;
  const labelled = reviews
    .filter((r) => r.section === section.name)
    .flatMap((r) => r.findings.map((finding) => ({ finding, r })))
    .map(({ finding, r }, i) => ({
      finding,
      label: `F${i + 1}`,
      reviewer: r.reviewer,
    }));
  const finders = new Set(labelled.map((l) => l.reviewer));
  if (finders.size <= 1) {
    return {
      merged: labelled.map((l) => ({
        ...l.finding,
        reviewers: [l.reviewer],
        section: section.name,
      })) as readonly MergedFinding[],
      spent: { costUsd: 0, seconds: 0, tokens: 0 } satisfies Spent,
    };
  }
  const answer = yield* models.ask({
    cwd: path.dirname(section.picture),
    effort: settings.effort,
    model: settings.judgeModel,
    prompt: yield* prompt("review-group", {
      findings: labelled.map((l) => listed(l.label, l.finding)).join("\n"),
      name: section.name,
      picture: path.basename(section.picture),
      where: section.where,
    }),
    ...groupAnswer,
  });
  return {
    merged: mergedFrom(section.name, labelled, answer.value.problems),
    spent: {
      costUsd: answer.costUsd,
      seconds: ((yield* Clock.currentTimeMillis) - started) / 1000,
      tokens: answer.tokens,
    } satisfies Spent,
  };
});

/**
 * What the reviews call well done, once each, as the designer is told before the findings: a fix
 * that sands it down is a worse design with a better score.
 */
export const keepText = (reviews: readonly SectionReview[]) => {
  const kept = [
    ...new Set(
      reviews.flatMap((r) => (r.keep ? [`${r.section}: ${r.keep}`] : []))
    ),
  ];
  return kept.length === 0
    ? ""
    : `\nKeep what they found well made; no fix undoes it:\n\n${kept.map((k) => `- ${k}`).join("\n")}\n`;
};

/** The share of the concerns the reviews answered for that they looked at. */
export const coverageShare = (reviews: readonly SectionReview[]) => {
  const rows = reviews.flatMap((r) => r.coverage ?? []);
  return {
    concerns: rows.length,
    reviewed: rows.filter((r) => r.verdict !== "not reviewed").length,
  };
};

/** What reviewing cost, all steps together. */
export const spentOf = (steps: readonly Spent[]): Spent => ({
  costUsd: steps.reduce((n, s) => n + s.costUsd, 0),
  seconds: steps.reduce((n, s) => n + s.seconds, 0),
  tokens: steps.reduce((n, s) => n + s.tokens, 0),
});
