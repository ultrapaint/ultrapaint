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
 */
import path from "node:path";
import { Clock, Effect, Schema } from "effect";
import { prompt } from "./layout.ts";
import { Models } from "./models.ts";

export const SectionFinding = Schema.Struct({
  fix: Schema.String,
  problem: Schema.String,
  title: Schema.String,
  where: Schema.String,
});
export type SectionFinding = typeof SectionFinding.Type;

const str = { type: "string" };
const findingSchema = {
  additionalProperties: false,
  properties: { fix: str, problem: str, title: str, where: str },
  required: ["title", "where", "problem", "fix"],
  type: "object",
};

/** What only a change to one of the design system's components would fix: not the designer's. */
export const SystemNote = Schema.Struct({
  component: Schema.String,
  note: Schema.String,
});
export type SystemNote = typeof SystemNote.Type;

const ReviewAnswer = Schema.Struct({
  findings: Schema.Array(SectionFinding),
  systemNotes: Schema.Array(SystemNote),
});
const reviewAnswer = {
  decode: ReviewAnswer,
  schema: {
    additionalProperties: false,
    properties: {
      findings: { items: findingSchema, type: "array" },
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
    required: ["findings", "systemNotes"],
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
  readonly findings: readonly SectionFinding[];
  readonly reviewer: string;
  readonly seconds: number;
  readonly section: string;
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
  return {
    costUsd: answer.costUsd,
    findings: answer.value.findings,
    reviewer,
    seconds: ((yield* Clock.currentTimeMillis) - started) / 1000,
    section: section.name,
    systemNotes: answer.value.systemNotes,
    tokens: answer.tokens,
  } satisfies SectionReview;
});

/** Every reviewer's review of every section, several at once. */
export const reviewSections = (
  sections: readonly SectionToReview[],
  reviewers: readonly string[],
  settings: ReviewSettings & { readonly concurrency: number }
) =>
  Effect.forEach(
    sections.flatMap((section) =>
      reviewers.map((reviewer) => ({ reviewer, section }))
    ),
    ({ reviewer, section }) => reviewSection(section, reviewer, settings),
    { concurrency: settings.concurrency }
  );

/** A finding under its label, as the grouping model is shown it. */
const listed = (label: string, f: SectionFinding) =>
  `${label}. **${f.title}** (${f.where}): ${f.problem} Fix: ${f.fix}`;

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
        fix: p.fix,
        problem: p.problem,
        reviewers: [...new Set(found.map((f) => f.reviewer))].sort(),
        section,
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

/** What reviewing cost, all steps together. */
export const spentOf = (steps: readonly Spent[]): Spent => ({
  costUsd: steps.reduce((n, s) => n + s.costUsd, 0),
  seconds: steps.reduce((n, s) => n + s.seconds, 0),
  tokens: steps.reduce((n, s) => n + s.tokens, 0),
});
