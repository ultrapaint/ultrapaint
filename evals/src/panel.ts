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
 * does it when they were not).
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { commitOf, RoundInfo, RunInfo, referencePictures } from "./generate.ts";
import { Judgement, roundRuns } from "./judge.ts";
import { readJson, writeJson, writeText } from "./layout.ts";
import { writeSkillTree } from "./recall.ts";
import { notesOf, REVIEW_FILE } from "./review-loop.ts";
import {
  mergeSection,
  type ReviewRequest,
  reviewSections,
  SectionFinding,
  type SectionToReview,
  SystemNote,
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
          findings: Schema.Array(SectionFinding),
          reviewer: Schema.String,
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

/** What the panel finds in one run's final page; kept in `panel.json` while the panel is the same. */
export const panelRun = Effect.fn("panelRun")(function* (
  run: { readonly dir: string; readonly reference: string },
  marked: readonly ReferenceSection[],
  tree: string,
  commit: string,
  request: ReviewRequest | undefined,
  options: PanelOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(run.dir, PANEL_FILE);
  if (yield* fs.exists(file)) {
    // A result from before the request was given does not decode, and is made again.
    const saved = yield* readJson(PanelResult, file).pipe(
      Effect.catchTag("EvalsError", () => Effect.void)
    );
    if (saved !== undefined && samePanel(saved, options, request)) {
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
        .map((r) => ({ findings: r.findings, reviewer: r.reviewer })),
      systemNotes: notesOf(
        reviews.filter((r) => r.section === section.name)
      ).map(({ section: _, ...note }) => note),
    })),
    withRequest: request !== undefined,
  };
  yield* writeJson(file, result);
  return result;
});

/** One run as the table shows it. */
export interface PanelRow {
  /** The judge's overall score, when the run was judged. */
  readonly fidelity: number | undefined;
  readonly panel: PanelResult;
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
    `What a fixed panel of fresh reviewers still finds in each run's final page, section by section: ${models.map((m) => `\`${m}\``).join(", ")}, grouped by \`${options.judgeModel}\`, effort ${options.effort}. Fewer problems is better. A problem is one thing wrong, whichever reviewers found it; a model's column counts its own findings. Notes counts what only a design-system component would fix, kept out of the problems. Fidelity is the judge's overall score (1–5).`,
    "",
    "## Per run",
    "",
    head([
      "Run",
      "Problems",
      ...models,
      "Notes",
      "Fidelity",
      "Seconds",
      "Review seconds",
      "Tokens",
    ]),
    ...rows.map((r) =>
      row([
        runName(r),
        `**${problemsOf(r.panel)}**`,
        ...models.map((m) => foundBy(r.panel, m)),
        notesCount(r.panel),
        r.fidelity ?? "–",
        r.seconds ?? "–",
        r.reviewSeconds === undefined ? "–" : Math.round(r.reviewSeconds),
        r.tokens === undefined ? "–" : `${Math.round(r.tokens / 1000)}k`,
      ])
    ),
    row([
      "**Mean**",
      `**${mean(rows.map((r) => problemsOf(r.panel)))}**`,
      ...models.map((m) => mean(rows.map((r) => foundBy(r.panel, m)))),
      mean(rows.map((r) => notesCount(r.panel))),
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
  result: PanelResult
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
  return {
    fidelity: judged?.scores.find((s) => s.area === "overall")?.score,
    panel: result,
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
        rows.push(yield* rowOf(run, result));
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
