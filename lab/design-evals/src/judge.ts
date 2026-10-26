/**
 * `judge`: each run of a round looked at beside its reference by a model acting as a senior
 * designer. It scores the run on every skill, and lists where the run is worse than the
 * reference, each tied to the skill that should have prevented it and to whether that skill says
 * so: the rule is missing, the rule is there and was not followed, the rule leads the wrong way,
 * or the tool could not do it.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { CONTENT_FILE } from "./capture.ts";
import { Claude } from "./claude.ts";
import {
  briefFile,
  captureDir,
  fromLab,
  LAB,
  listDir,
  prompt,
  RUNS,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";
import { loadReference } from "./reference.ts";

export const COVERAGE = [
  "not-covered",
  "covered-not-followed",
  "rule-misleads",
  "tool-limitation",
] as const;

export const Finding = Schema.Struct({
  coverage: Schema.Literals(COVERAGE),
  evidence: Schema.String,
  generated: Schema.String,
  impact: Schema.Literals(["high", "medium", "low"]),
  reference: Schema.String,
  rule: Schema.String,
  skill: Schema.String,
  title: Schema.String,
  viewport: Schema.Literals(["desktop", "mobile", "both"]),
});
export type Finding = typeof Finding.Type;

export const Judgement = Schema.Struct({
  fidelity: Schema.Struct({
    added: Schema.Array(Schema.String),
    missing: Schema.Array(Schema.String),
  }),
  findings: Schema.Array(Finding),
  scores: Schema.Array(
    Schema.Struct({
      area: Schema.String,
      note: Schema.String,
      score: Schema.Number,
    })
  ),
  strengths: Schema.Array(Schema.String),
  summary: Schema.String,
});
export type Judgement = typeof Judgement.Type;

/** The judge's answer as JSON Schema, with the round's skills as the areas it may name. */
const judgementSchema = (skills: readonly string[]) => {
  const string = { type: "string" };
  const strings = { items: string, type: "array" };
  return {
    additionalProperties: false,
    properties: {
      fidelity: {
        additionalProperties: false,
        properties: { added: strings, missing: strings },
        required: ["added", "missing"],
        type: "object",
      },
      findings: {
        items: {
          additionalProperties: false,
          properties: {
            coverage: { enum: COVERAGE, type: "string" },
            evidence: string,
            generated: string,
            impact: { enum: ["high", "medium", "low"], type: "string" },
            reference: string,
            rule: string,
            skill: { enum: [...skills, "none"], type: "string" },
            title: string,
            viewport: { enum: ["desktop", "mobile", "both"], type: "string" },
          },
          required: [
            "title",
            "skill",
            "coverage",
            "impact",
            "viewport",
            "reference",
            "generated",
            "rule",
            "evidence",
          ],
          type: "object",
        },
        type: "array",
      },
      scores: {
        items: {
          additionalProperties: false,
          properties: {
            area: { enum: [...skills, "overall"], type: "string" },
            note: string,
            score: { maximum: 5, minimum: 1, type: "integer" },
          },
          required: ["area", "score", "note"],
          type: "object",
        },
        type: "array",
      },
      strengths: strings,
      summary: string,
    },
    required: ["summary", "scores", "findings", "fidelity", "strengths"],
    type: "object",
  };
};

/** The skills the round's agents were told, by name. */
export const roundSkills = (round: string) =>
  Effect.map(listDir(path.join(RUNS, round, "skills")), (files) =>
    files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
  );

/** Every run of a round that was generated: `<round>/<reference>/run-<n>/run.json`. */
export const roundRuns = Effect.fn("roundRuns")(function* (round: string) {
  const fs = yield* FileSystem.FileSystem;
  const found: { readonly dir: string; readonly reference: string }[] = [];
  const isDirectory = (dir: string) =>
    Effect.map(fs.stat(dir), (info) => info.type === "Directory");
  for (const reference of yield* listDir(path.join(RUNS, round))) {
    // Beside the references' directories: round.json, the report, skills/, proposals/.
    if (!(yield* isDirectory(path.join(RUNS, round, reference)))) {
      continue;
    }
    for (const run of yield* listDir(path.join(RUNS, round, reference))) {
      const dir = path.join(RUNS, round, reference, run);
      if (yield* fs.exists(path.join(dir, "run.json"))) {
        found.push({ dir, reference });
      }
    }
  }
  return found;
});

const render = (judgement: Judgement) =>
  [
    judgement.summary,
    "",
    "| Area | Score | Note |",
    "| --- | --- | --- |",
    ...judgement.scores.map((s) => `| ${s.area} | ${s.score} | ${s.note} |`),
    "",
    "## Findings",
    "",
    ...judgement.findings.flatMap((f) => [
      `### ${f.title}`,
      "",
      `${f.skill} · ${f.coverage} · ${f.impact} · ${f.viewport}`,
      "",
      `- Reference: ${f.reference}`,
      `- Generated: ${f.generated}`,
      `- Rule: ${f.rule}`,
      `- Seen in: ${f.evidence}`,
      "",
    ]),
    "## Content",
    "",
    `- Missing: ${judgement.fidelity.missing.join("; ") || "nothing"}`,
    `- Added: ${judgement.fidelity.added.join("; ") || "nothing"}`,
    "",
    "## Strengths",
    "",
    ...judgement.strengths.map((s) => `- ${s}`),
    "",
  ].join("\n");

const judgeRun = Effect.fn("judgeRun")(function* (
  round: string,
  run: { readonly dir: string; readonly reference: string },
  skills: readonly string[],
  model: string
) {
  const claude = yield* Claude;
  const fs = yield* FileSystem.FileSystem;
  const reference = yield* loadReference(run.reference);
  const pictures = (dir: string) =>
    Effect.map(listDir(dir), (files) =>
      files
        .filter((f) => f.endsWith(".jpg") || f.endsWith(".png"))
        .map((f) => `- ${fromLab(path.join(dir, f))}`)
        .join("\n")
    );
  const generated = yield* pictures(path.join(run.dir, "shots"));
  const info = yield* fs.readFileString(path.join(run.dir, "run.json"));
  const answer = yield* claude.ask({
    cwd: LAB,
    model,
    prompt: yield* prompt("judge", {
      agent: fromLab(path.join(run.dir, "agent.md")),
      brief: fromLab(briefFile(reference.id)),
      content: fromLab(path.join(captureDir(reference.id), CONTENT_FILE)),
      generated: generated || "(no pictures: the run made nothing to look at)",
      kind: reference.kind,
      name: reference.name,
      pages: fromLab(path.join(run.dir, "pages")),
      reference: yield* pictures(captureDir(reference.id)),
      run: info,
      skills: fromLab(path.join(RUNS, round, "skills")),
      trace: fromLab(path.join(run.dir, "trace.md")),
      why: reference.why,
    }),
    schema: judgementSchema(skills),
  });
  const judgement = yield* Schema.decodeUnknownEffect(Judgement)(
    answer.structured
  );
  yield* writeJson(path.join(run.dir, "judge.json"), {
    ...judgement,
    costUsd: answer.costUsd,
  });
  yield* writeText(path.join(run.dir, "judge.md"), render(judgement));
  const overall = judgement.scores.find((s) => s.area === "overall")?.score;
  yield* Effect.log(
    `${fromLab(run.dir)}: ${judgement.findings.length} findings, overall ${overall ?? "?"}/5 ($${answer.costUsd.toFixed(2)})`
  );
});

export const judge = Effect.fn("judge")(function* (
  round: string,
  options: {
    readonly concurrency: number;
    readonly force: boolean;
    readonly model: string;
  }
) {
  const fs = yield* FileSystem.FileSystem;
  const skills = yield* roundSkills(round);
  const runs = yield* roundRuns(round);
  const pending = options.force
    ? runs
    : yield* Effect.filter(runs, (run) =>
        Effect.map(fs.exists(path.join(run.dir, "judge.json")), (done) => !done)
      );
  yield* Effect.log(`judging ${pending.length} of ${runs.length} runs`);
  yield* Effect.forEach(
    pending,
    (run) =>
      judgeRun(round, run, skills, options.model).pipe(
        // One judgement that fails is reported and the others go on; judge again to retry it.
        Effect.catch((error) =>
          Effect.logError(`${fromLab(run.dir)}: not judged: ${String(error)}`)
        )
      ),
    { concurrency: options.concurrency }
  );
});

/** A run's judgement, when it has one. */
export const readJudgement = (dir: string) =>
  readJson(Judgement, path.join(dir, "judge.json"));
