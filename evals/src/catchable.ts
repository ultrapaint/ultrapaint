/**
 * `catchable`: how each design finding we hold could have been caught, the cheapest reliable way
 * first (the shift-left proposal, 2026-11-04):
 *
 * - `code`: a general check, one rule written once for every screen without knowing the problem,
 *   decides it on the rendered page or the design document (a contrast, a size, a ratio of gaps,
 *   a value off the scale, a text that overflows); the report counts the findings each check
 *   would catch, which says what to build first;
 * - `outline`: a text outline written before drawing shows it: the sections in order, every word,
 *   each control and what it does, which states exist and when each part shows;
 * - `eye`: it takes seeing the rendered look.
 *
 * The findings come from three sources: the design gaps (`evals/gaps/`), the held-out findings a
 * person rated real in a decision deck, and what a fixed panel found in a round's designs
 * (`panel.json`, unrated). A model sorts them in batches; each batch is kept, so a run resumes.
 * It ends on `runs/<name>/report.md`: the counts per source and kind, and every finding's kind
 * with the check or outline element that would catch it.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { isFinding, loadGaps, partOf } from "./gap.ts";
import { roundRuns } from "./judge.ts";
import { prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";

export const CATCHES = ["code", "outline", "eye"] as const;
export type Catch = (typeof CATCHES)[number];

/** One finding to sort, from wherever it came. */
export interface ToSort {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly title: string;
}

const Sorted = Schema.Struct({
  catch: Schema.Literals(CATCHES),
  /** For `code`: the general check that catches it, named the same for the same check. */
  check: Schema.String,
  /** The check, or what in the outline shows it, or what has to be seen, in a sentence. */
  how: Schema.String,
  id: Schema.String,
});
export type Sorted = typeof Sorted.Type;

const Batch = Schema.Struct({ items: Schema.Array(Sorted) });
const str = { type: "string" };
const batchAnswer = {
  decode: Batch,
  schema: {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            catch: { enum: [...CATCHES], type: "string" },
            check: str,
            how: str,
            id: str,
          },
          required: ["id", "catch", "check", "how"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["items"],
    type: "object",
  },
};

const Deck = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({
      body: Schema.String,
      id: Schema.String,
      title: Schema.String,
    })
  ),
});
const Answers = Schema.Record(
  Schema.String,
  Schema.Struct({ choice: Schema.optional(Schema.String) })
);
const Panel = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      problems: Schema.Array(
        Schema.Struct({
          problem: Schema.String,
          title: Schema.String,
          where: Schema.String,
        })
      ),
    })
  ),
});

/** The design gaps a person saw: each one's title and what happened. */
const gapFindings = Effect.gen(function* () {
  const gaps = yield* loadGaps();
  return gaps.filter(isFinding).map(
    (g): ToSort => ({
      id: g.id,
      source: "gaps",
      text: partOf(g.body, "What happened"),
      title: g.title,
    })
  );
});

/** A deck's findings the person answered `real`. */
const deckFindings = Effect.fn("deckFindings")(function* (deck: string) {
  const { data } = yield* EvalsConfig;
  const dir = path.join(data.root, "decisions");
  const { cards } = yield* readJson(Deck, path.join(dir, `${deck}.json`));
  const answers = yield* readJson(
    Answers,
    path.join(dir, `${deck}.answers.json`)
  );
  return cards
    .filter((c) => answers[c.id]?.choice === "real")
    .map(
      (c): ToSort => ({
        id: `${deck}/${c.id}`,
        source: `rated real in ${deck}`,
        // The card's first paragraph is the finding; what follows says where to look.
        text: c.body.split("\n\n")[0] ?? c.body,
        title: c.title,
      })
    );
});

/** What a fixed panel found in a round's designs. */
const panelFindings = Effect.fn("panelFindings")(function* (round: string) {
  const fs = yield* FileSystem.FileSystem;
  const found: ToSort[] = [];
  for (const run of yield* roundRuns(round)) {
    const file = path.join(run.dir, "panel.json");
    if (!(yield* fs.exists(file))) {
      continue;
    }
    const panel = yield* readJson(Panel, file);
    for (const section of panel.sections) {
      section.problems.forEach((p, i) => {
        found.push({
          id: `${round}/${run.reference}/${path.basename(run.dir)}/${section.name}#${i + 1}`,
          source: `panel on ${round}`,
          text: `${p.problem} (${p.where})`,
          title: p.title,
        });
      });
    }
  }
  return found;
});

export interface CatchableOptions {
  readonly batch: number;
  readonly concurrency: number;
  /** Decision decks whose findings answered `real` are sorted. */
  readonly decks: readonly string[];
  readonly effort: string;
  readonly model: string;
  readonly name: string;
  /** Rounds whose `panel.json` findings are sorted. */
  readonly panels: readonly string[];
}

/** The counts of a set of sorted findings, per kind. */
export const countsOf = (sorted: readonly Sorted[]) =>
  Object.fromEntries(
    CATCHES.map((c) => [c, sorted.filter((s) => s.catch === c).length])
  ) as Record<Catch, number>;

const share = (n: number, of: number) =>
  of === 0 ? "–" : `${n} (${Math.round((n / of) * 100)}%)`;

/** The report: counts per source and kind, then every finding with how it would be caught. */
export const catchableReport = (
  name: string,
  findings: readonly ToSort[],
  sorted: ReadonlyMap<string, Sorted>,
  model: string
) => {
  const sources = [...new Set(findings.map((f) => f.source))];
  const row = (cells: readonly (string | number)[]) =>
    `| ${cells.join(" | ")} |`;
  const lines = [
    `# Catchable: ${name}`,
    "",
    `How each finding could have been caught, the cheapest reliable way, as \`${model}\` sorted them: \`code\` (a program reading the rendered page or the document), \`outline\` (a text outline of the sections, words, actions and states, written before drawing), \`eye\` (it takes seeing the look).`,
    "",
    row(["Source", "Findings", ...CATCHES]),
    row(["---", "---", ...CATCHES.map(() => "---")]),
  ];
  const all: Sorted[] = [];
  for (const source of sources) {
    const these = findings.flatMap((f) => {
      const s = f.source === source ? sorted.get(f.id) : undefined;
      return s === undefined ? [] : [s];
    });
    all.push(...these);
    const counts = countsOf(these);
    lines.push(
      row([
        source,
        these.length,
        ...CATCHES.map((c) => share(counts[c], these.length)),
      ])
    );
  }
  const total = countsOf(all);
  lines.push(
    row([
      "**All**",
      `**${all.length}**`,
      ...CATCHES.map((c) => `**${share(total[c], all.length)}**`),
    ]),
    ""
  );
  const checks = new Map<string, number>();
  for (const s of all) {
    if (s.catch === "code") {
      const check = s.check.trim().toLowerCase() || "(unnamed)";
      checks.set(check, (checks.get(check) ?? 0) + 1);
    }
  }
  lines.push(
    "## The general checks, by the findings each catches",
    "",
    row(["Check", "Findings"]),
    row(["---", "---"]),
    ...[...checks.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([check, n]) => row([check.replaceAll("|", "/"), n])),
    ""
  );
  for (const source of sources) {
    lines.push(`## ${source}`, "", row(["Finding", "Kind", "How"]));
    lines.push(row(["---", "---", "---"]));
    for (const f of findings.filter((x) => x.source === source)) {
      const s = sorted.get(f.id);
      lines.push(
        row([
          `\`${f.id}\` ${f.title}`.replaceAll("|", "/"),
          s?.catch ?? "not sorted",
          (s?.how ?? "").replaceAll("|", "/"),
        ])
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const catchable = Effect.fn("catchable")(function* (
  options: CatchableOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const out = path.join(data.runs, options.name);
  const findings: ToSort[] = [...(yield* gapFindings)];
  for (const deck of options.decks) {
    findings.push(...(yield* deckFindings(deck)));
  }
  for (const round of options.panels) {
    findings.push(...(yield* panelFindings(round)));
  }
  // The model's working directory: it must be there before the model starts.
  yield* fs.makeDirectory(out, { recursive: true });
  const batches = Array.from(
    { length: Math.ceil(findings.length / options.batch) },
    (_, i) => findings.slice(i * options.batch, (i + 1) * options.batch)
  );
  const done = yield* Effect.forEach(
    batches,
    (batch, i) =>
      Effect.gen(function* () {
        const file = path.join(out, "batches", `${i + 1}.json`);
        if (yield* fs.exists(file)) {
          return (yield* readJson(Batch, file)).items;
        }
        const answer = yield* models.ask({
          cwd: out,
          effort: options.effort,
          model: options.model,
          prompt: yield* prompt("catchable", {
            findings: batch
              .map((f) => `- \`${f.id}\` **${f.title}.** ${f.text.trim()}`)
              .join("\n"),
          }),
          ...batchAnswer,
        });
        yield* writeJson(file, answer.value);
        yield* Effect.log(`batch ${i + 1}/${batches.length} sorted`);
        return answer.value.items;
      }).pipe(
        // A batch that fails is left out and asked again on the next run.
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(
            Effect.logWarning(`batch ${i + 1}: not sorted: ${error.message}`),
            [] as readonly Sorted[]
          )
        )
      ),
    { concurrency: options.concurrency }
  );
  const sorted = new Map(done.flat().map((s) => [s.id, s]));
  yield* writeJson(path.join(out, "catchable.json"), {
    findings,
    model: options.model,
    sorted: [...sorted.values()],
  });
  const file = path.join(out, "report.md");
  yield* writeText(
    file,
    catchableReport(options.name, findings, sorted, options.model)
  );
  const counts = countsOf([...sorted.values()]);
  yield* Effect.log(
    `${sorted.size}/${findings.length} sorted: ${CATCHES.map((c) => `${c} ${counts[c]}`).join(", ")}; ${data.fromData(file)}`
  );
});
