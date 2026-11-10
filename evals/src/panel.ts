/**
 * `panel`: finished designs scored by what a fixed panel of fresh reviewers still finds in them
 * (ADR 0060). Every panel model reviews every section of each run's final page, with the skill of
 * the checkout the command runs from, the same for every round it scores, within what the run's
 * designer was asked (the brief, and the pictures when the round gave them); the findings of a
 * section are grouped by the judge model into problems. Fewer problems is better. What only a
 * design-system component would fix is counted apart, as system notes.
 *
 * It writes `panel.json` in each run, kept while the panel is the same, and `panel.md` in each
 * round: the problems per run and per section, by panel model, beside the judge's overall score
 * and what the run took. It works on any round whose runs were cut into sections (`sections`
 * does it when they were not); a run with no section to show is not reviewed, and is in neither.
 */
import path from "node:path";
import {
  CATEGORY_FILES,
  Category,
  pageScore,
  SignOff,
} from "@ultrapaint/contracts/review";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { commitOf, RoundInfo, RunInfo, referencePictures } from "./generate.ts";
import { Judgement, roundRuns } from "./judge.ts";
import { readJson, writeJson, writeText } from "./layout.ts";
import { skillReads } from "./pairwise.ts";
import { writeSkillTree } from "./recall.ts";
import { notesOf, REVIEW_FILE } from "./review-loop.ts";
import {
  mergeSection,
  type ReviewRequest,
  reviewSections,
  SectionFinding,
  type SectionToReview,
  SystemNote,
  scoreOfReview,
  spentOf,
} from "./section-review.ts";
import {
  type ReferenceSection,
  readRunSections,
  referenceSections,
  runSections,
} from "./sections.ts";

export const PANEL_FILE = "panel.json";

const Problem = Schema.Struct({
  ...SectionFinding.fields,
  reviewers: Schema.Array(Schema.String),
  section: Schema.String,
});

export const PanelResult = Schema.Struct({
  commit: Schema.String,
  costUsd: Schema.Number,
  effort: Schema.String,
  judgeModel: Schema.String,
  models: Schema.Array(Schema.String),
  sections: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      /** From the run's directory. */
      picture: Schema.String,
      problems: Schema.Array(Problem),
      reviews: Schema.Array(
        Schema.Struct({
          /** Why it gave no review of the section; it then has no score there. */
          failed: Schema.optional(Schema.String),
          findings: Schema.Array(SectionFinding),
          reached: Schema.Array(Category),
          reviewer: Schema.String,
          signOff: SignOff,
        })
      ),
      /** What only a design-system component would fix, each once. */
      systemNotes: Schema.Array(
        Schema.Struct({ ...SystemNote.fields, reviewer: Schema.String })
      ),
    })
  ),
  /** Whether the panel reviewed within the designer's request (the brief, and its pictures). */
  withRequest: Schema.Boolean,
});
export type PanelResult = typeof PanelResult.Type;

export interface PanelOptions {
  readonly concurrency: number;
  readonly effort: string;
  /** The model that cuts runs into sections and groups the panel's findings. */
  readonly judgeModel: string;
  /** The panel: the models that review. */
  readonly models: readonly string[];
}

/** Whether a saved result is the same panel's. */
const samePanel = (
  saved: PanelResult,
  options: PanelOptions,
  request: ReviewRequest | undefined
) =>
  saved.withRequest === (request !== undefined) &&
  saved.judgeModel === options.judgeModel &&
  [...saved.models].sort().join(",") === [...options.models].sort().join(",");

/**
 * What the panel finds in one run's final page; kept in `panel.json` while the panel is the same.
 * Nothing for a run with no section to review: it has no result, kept or returned.
 */
export const panelRun = Effect.fn("panelRun")(function* (
  run: { readonly dir: string; readonly reference: string },
  marked: readonly ReferenceSection[],
  tree: string,
  commit: string,
  request: ReviewRequest | undefined,
  options: PanelOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(run.dir, PANEL_FILE);
  if (yield* fs.exists(file)) {
    // A result from before the request was given does not decode, and is made again; so is one
    // with no sections, which reviewed nothing.
    const saved = yield* readJson(PanelResult, file).pipe(
      Effect.catchTag("EvalsError", () => Effect.void)
    );
    if (
      saved !== undefined &&
      saved.sections.length > 0 &&
      samePanel(saved, options, request)
    ) {
      return saved;
    }
  }
  let crops = yield* readRunSections(run.dir);
  if (crops.size === 0 && marked.length > 0) {
    yield* runSections(run.dir, marked, options.judgeModel);
    crops = yield* readRunSections(run.dir);
  }
  const pages = path.join(run.dir, "pages");
  const hasPages = yield* fs.exists(pages);
  const sections: SectionToReview[] = marked.flatMap((s) => {
    const picture = crops.get(s.name);
    return picture === undefined
      ? []
      : [
          {
            name: s.name,
            picture,
            where: s.what,
            ...(hasPages && { pages }),
          },
        ];
  });
  if (sections.length === 0) {
    // Reviewed blind, a run would score as one the panel found nothing wrong in.
    return yield* Effect.logWarning(
      `${data.fromData(run.dir)}: not reviewed: it has no sections (no pictures, or none of the reference's sections found in them)`
    );
  }
  const settings = { ...options, request, tree };
  const reviews = yield* reviewSections(sections, options.models, settings);
  const merges = yield* Effect.forEach(
    sections,
    (section) => mergeSection(section, reviews, settings),
    { concurrency: options.concurrency }
  );
  const result: PanelResult = {
    commit,
    costUsd: spentOf([...reviews, ...merges.map((m) => m.spent)]).costUsd,
    effort: options.effort,
    judgeModel: options.judgeModel,
    models: options.models,
    sections: sections.map((section, i) => ({
      name: section.name,
      picture: path.relative(run.dir, section.picture),
      problems: merges[i]?.merged ?? [],
      reviews: reviews
        .filter((r) => r.section === section.name)
        .map((r) => ({
          ...(r.failed !== undefined && { failed: r.failed }),
          findings: r.findings,
          reached: r.reached,
          reviewer: r.reviewer,
          signOff: r.signOff,
        })),
      systemNotes: notesOf(
        reviews.filter((r) => r.section === section.name)
      ).map(({ section: _, ...note }) => note),
    })),
    withRequest: request !== undefined,
  };
  yield* writeJson(file, result);
  return result;
});

/** How a round's designers were told the design skill (`EVAL_SKILLS_BRIEFING`). */
export type Told = "router" | "full" | "summaries";

export interface ReadWhenNeeded {
  /** The skill's files its sections reached, beyond what the briefing told whole. */
  readonly needed: readonly string[];
  /** Those of them the run opened. */
  readonly read: readonly string[];
}

/**
 * Whether a run read the files of the skill its sections needed (ADR 0048): a category is reached
 * where a reviewer found the section reaching it or a finding in it, and needs the file that
 * holds its rules (`CATEGORY_FILES`), read where the run opened it. A round told the core whole
 * (`router`) needs to open no category the core holds; one told everything (`full`), none.
 */
export const readWhenNeeded = (
  result: PanelResult,
  reads: readonly string[],
  told: Told
): ReadWhenNeeded => {
  const reached = new Set<Category>();
  for (const section of result.sections) {
    for (const review of section.reviews) {
      for (const category of review.reached) {
        reached.add(category);
      }
      for (const finding of review.findings) {
        reached.add(finding.category);
      }
    }
  }
  const opened = new Set(reads);
  const files = new Set([...reached].map((c) => CATEGORY_FILES[c]));
  const needed =
    told === "full"
      ? []
      : [...files]
          .filter((file) => told === "summaries" || file !== "SKILL.md")
          .sort();
  return { needed, read: needed.filter((file) => opened.has(file)) };
};

const readsCell = (reads: ReadWhenNeeded | undefined) =>
  reads === undefined || reads.needed.length === 0
    ? "–"
    : `${reads.read.length}/${reads.needed.length}`;

/** The share of the skill's files needed that were read, over every run that needed one. */
const readsShare = (rows: readonly PanelRow[]) => {
  const needed = rows.reduce((n, r) => n + (r.reads?.needed.length ?? 0), 0);
  const read = rows.reduce((n, r) => n + (r.reads?.read.length ?? 0), 0);
  return needed === 0 ? "–" : `${Math.round((read / needed) * 100)}%`;
};

/** One run as the table shows it. */
export interface PanelRow {
  /** The judge's overall score, when the run was judged. */
  readonly fidelity: number | undefined;
  readonly panel: PanelResult;
  /** The skill's files its sections needed and how many of them it opened, when its trace says. */
  readonly reads: ReadWhenNeeded | undefined;
  readonly reference: string;
  /** What reviewing took in the run's loop, when it had one. */
  readonly reviewSeconds: number | undefined;
  readonly run: string;
  readonly seconds: number | undefined;
  readonly tokens: number | undefined;
}

const row = (cells: readonly (string | number)[]) => `| ${cells.join(" | ")} |`;
const head = (cells: readonly string[]) =>
  [row(cells), row(cells.map(() => "---"))].join("\n");
const mean = (values: readonly number[]) =>
  values.length === 0
    ? "–"
    : (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);

/** How many findings a panel model made in a run, every section together. */
const foundBy = (result: PanelResult, model: string) =>
  result.sections.reduce(
    (n, s) =>
      n +
      s.reviews
        .filter((r) => r.reviewer === model)
        .reduce((m, r) => m + r.findings.length, 0),
    0
  );

/**
 * A panel model's score of a run's page, out of 100, from its own findings (contracts' `review`):
 * `no score` where it gave no review.
 */
export const scoreBy = (result: PanelResult, model: string) =>
  pageScore(
    result.sections.flatMap((s) =>
      s.reviews
        .filter((r) => r.reviewer === model)
        .map((r) => ({
          name: s.name,
          score: scoreOfReview({
            costUsd: 0,
            ...(r.failed !== undefined && { failed: r.failed }),
            findings: r.findings,
            reached: r.reached,
            reviewer: r.reviewer,
            seconds: 0,
            section: s.name,
            signOff: r.signOff,
            systemNotes: [],
            tokens: 0,
          }),
        }))
    )
  );

const scoreCell = (result: PanelResult, model: string) => {
  const score = scoreBy(result, model);
  return score.kind === "none"
    ? "no score"
    : `${score.overall} (${foundBy(result, model)})`;
};

const scoreValue = (result: PanelResult, model: string) => {
  const score = scoreBy(result, model);
  return score.kind === "none" ? [] : [score.overall];
};

const problemsOf = (result: PanelResult) =>
  result.sections.reduce((n, s) => n + s.problems.length, 0);

const notesCount = (result: PanelResult) =>
  result.sections.reduce((n, s) => n + s.systemNotes.length, 0);

/** The round's table: problems per run and per section, by panel model, beside its score and cost. */
export const panelTable = (
  round: string,
  rows: readonly PanelRow[],
  options: Pick<PanelOptions, "effort" | "judgeModel" | "models">
) => {
  const { models } = options;
  const sections = [
    ...new Set(rows.flatMap((r) => r.panel.sections.map((s) => s.name))),
  ];
  const runName = (r: PanelRow) => `${r.reference}/${r.run}`;
  const lines = [
    `# Panel: ${round}`,
    "",
    `What a fixed panel of fresh reviewers still finds in each run's final page, section by section: ${models.map((m) => `\`${m}\``).join(", ")}, grouped by \`${options.judgeModel}\`, effort ${options.effort}. Fewer problems is better. A problem is one thing wrong, whichever reviewers found it. A model's column is its score out of 100 from its own findings, higher being better, with how many it made in brackets; "no score" where it gave no review. Notes counts what only a design-system component would fix, kept out of the problems. Fidelity is the judge's overall score (1–5). Read is how many the run opened of the skill's files that hold what its sections reached, beyond those the briefing tells whole.`,
    "",
    "## Per run",
    "",
    head([
      "Run",
      "Problems",
      ...models,
      "Notes",
      "Read",
      "Fidelity",
      "Seconds",
      "Review seconds",
      "Tokens",
    ]),
    ...rows.map((r) =>
      row([
        runName(r),
        `**${problemsOf(r.panel)}**`,
        ...models.map((m) => scoreCell(r.panel, m)),
        notesCount(r.panel),
        readsCell(r.reads),
        r.fidelity ?? "–",
        r.seconds ?? "–",
        r.reviewSeconds === undefined ? "–" : Math.round(r.reviewSeconds),
        r.tokens === undefined ? "–" : `${Math.round(r.tokens / 1000)}k`,
      ])
    ),
    row([
      "**Mean**",
      `**${mean(rows.map((r) => problemsOf(r.panel)))}**`,
      ...models.map((m) => mean(rows.flatMap((r) => scoreValue(r.panel, m)))),
      mean(rows.map((r) => notesCount(r.panel))),
      readsShare(rows),
      mean(rows.flatMap((r) => (r.fidelity === undefined ? [] : [r.fidelity]))),
      mean(rows.flatMap((r) => (r.seconds === undefined ? [] : [r.seconds]))),
      mean(
        rows.flatMap((r) =>
          r.reviewSeconds === undefined ? [] : [r.reviewSeconds]
        )
      ),
      "",
    ]),
    "",
    "## Per section",
    "",
    "Problems found in each section of each run; – where the run has no such section.",
    "",
    head(["Section", ...rows.map(runName), "Mean"]),
    ...sections.map((name) => {
      const counts = rows.map(
        (r) => r.panel.sections.find((s) => s.name === name)?.problems.length
      );
      return row([
        name,
        ...counts.map((c) => c ?? "–"),
        mean(counts.flatMap((c) => (c === undefined ? [] : [c]))),
      ]);
    }),
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const ReviewTotals = Schema.Struct({
  totals: Schema.Struct({
    review: Schema.Struct({ seconds: Schema.Number }),
  }),
});

/** A run's row: its panel, its judge's overall score, and what it took. */
const rowOf = Effect.fn("rowOf")(function* (
  run: { readonly dir: string; readonly reference: string },
  result: PanelResult,
  told: Told
) {
  const fs = yield* FileSystem.FileSystem;
  const optional = <S extends Schema.Top>(schema: S, file: string) =>
    Effect.gen(function* () {
      const at = path.join(run.dir, file);
      return (yield* fs.exists(at)) ? yield* readJson(schema, at) : undefined;
    });
  const judged = yield* optional(Judgement, "judge.json");
  const info = yield* optional(RunInfo, "run.json");
  const review = yield* optional(ReviewTotals, REVIEW_FILE);
  const trace = path.join(run.dir, "trace.md");
  const reads = (yield* fs.exists(trace))
    ? readWhenNeeded(result, skillReads(yield* fs.readFileString(trace)), told)
    : undefined;
  return {
    fidelity: judged?.scores.find((s) => s.area === "overall")?.score,
    panel: result,
    reads,
    reference: run.reference,
    reviewSeconds: review?.totals.review.seconds,
    run: path.basename(run.dir),
    seconds: info?.seconds,
    tokens: info?.tokens,
  } satisfies PanelRow;
});

/**
 * What a round's designers were asked: the reference's brief, and its pictures when the round gave
 * them; none when the brief is gone.
 */
const requestOf = Effect.fn("requestOf")(function* (
  round: string,
  reference: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const briefFile = data.briefFile(reference);
  if (!(yield* fs.exists(briefFile))) {
    return;
  }
  const roundFile = path.join(data.runs, round, "round.json");
  const info = (yield* fs.exists(roundFile))
    ? yield* readJson(RoundInfo, roundFile)
    : undefined;
  return {
    brief: yield* fs.readFileString(briefFile),
    pictures: info?.picture ? yield* referencePictures(reference) : [],
  } satisfies ReviewRequest;
});

/** How a round's designers were told the skill, as its `round.json` records it: `built-in (full)`. */
const toldIn = Effect.fn("toldIn")(function* (round: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.runs, round, "round.json");
  if (!(yield* fs.exists(file))) {
    return "router" satisfies Told;
  }
  const { skills } = yield* readJson(RoundInfo, file);
  if (skills.endsWith("(full)")) {
    return "full" satisfies Told;
  }
  return skills.endsWith("(summaries)") ? "summaries" : "router";
});

export const panel = Effect.fn("panel")(function* (
  rounds: readonly string[],
  options: PanelOptions
) {
  const { data } = yield* EvalsConfig;
  const commit = yield* commitOf;
  const marked = new Map<string, readonly ReferenceSection[]>();
  for (const round of rounds) {
    // The panel reads the skill of the checkout the command runs from, written into the round.
    const tree = yield* writeSkillTree(
      path.join(data.runs, round, "panel", "skill"),
      "built-in"
    );
    const runs = yield* roundRuns(round);
    const told = yield* toldIn(round);
    const rows: PanelRow[] = [];
    for (const run of runs) {
      if (!marked.has(run.reference)) {
        marked.set(
          run.reference,
          yield* referenceSections(run.reference, {
            force: false,
            model: options.judgeModel,
          })
        );
      }
      const result = yield* panelRun(
        run,
        marked.get(run.reference) ?? [],
        tree,
        commit,
        yield* requestOf(round, run.reference),
        options
      ).pipe(
        // One run that fails is reported and the others go on; run the panel again to retry it.
        Effect.catch((error) =>
          Effect.as(
            Effect.logError(
              `${data.fromData(run.dir)}: not reviewed: ${String(error)}`
            ),
            undefined
          )
        )
      );
      if (result !== undefined) {
        rows.push(yield* rowOf(run, result, told));
        yield* Effect.log(
          `${data.fromData(run.dir)}: ${problemsOf(result)} problems`
        );
      }
    }
    const file = path.join(data.runs, round, "panel.md");
    yield* writeText(file, panelTable(round, rows, options));
    yield* Effect.log(
      `${round}: ${mean(rows.map((r) => problemsOf(r.panel)))} problems per run; ${data.fromData(file)}`
    );
  }
});
