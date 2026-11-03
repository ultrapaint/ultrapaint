/**
 * `judge`: each run of a round looked at beside its reference by a model acting as a senior
 * designer. It scores the run at every level of design (layout, hierarchy, components, restraint…)
 * and lists where the run is worse than the reference, each at its level and tied to the skill that
 * should have prevented it and to whether that skill says so: the rule is missing, the rule is
 * there and was not followed, the rule leads the wrong way, or the tool could not do it.
 *
 * It also says, of every text the page shows that the brief did not, whether it is noise, content
 * the agent invented, or needed: what "less is more" is counted with.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { CONTENT_FILE } from "./capture.ts";

import { EvalsConfig } from "./config.ts";
import { ADDED_TEXT_FILE } from "./generate.ts";
import {
  listDir,
  PROMPTS,
  prompt,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";
import { Models } from "./models.ts";
import { loadReference } from "./reference.ts";

/**
 * The levels a design is looked at, each scored on its own: where it is weak says what kind of
 * teaching it lacks, whichever skill the rule ends up in.
 */
export const LEVELS = [
  "layout",
  "hierarchy",
  "components",
  "restraint",
  "typography",
  "color",
  "spacing",
  "craft",
] as const;
export type Level = (typeof LEVELS)[number];
const LEVEL_NAMES: ReadonlySet<string> = new Set(LEVELS);
/** Whether a score's area is one of the levels; the others are older rounds' skills, or `overall`. */
export const isLevel = (area: string): area is Level => LEVEL_NAMES.has(area);

export const ADDED_VERDICTS = ["noise", "invented", "needed"] as const;
/**
 * What an added text is: `copy`, the words of the interface (a label, a title, a description, a
 * caption, a button's words), which "less is more" is about; or `data`, what the screen shows
 * (a name, an email, a number, a date, a row of a table), which a prototype fills in.
 */
export const ADDED_ROLES = ["copy", "data"] as const;

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
  /** Absent in judgements from before the levels. */
  level: Schema.optional(Schema.Literals(LEVELS)),
  reference: Schema.String,
  rule: Schema.String,
  skill: Schema.String,
  title: Schema.String,
  viewport: Schema.Literals(["desktop", "mobile", "both"]),
});
export type Finding = typeof Finding.Type;

export const Judgement = Schema.Struct({
  /** Of every text the brief did not hold, by its index in `added-text.json`. */
  addedText: Schema.optional(
    Schema.Array(
      Schema.Struct({
        index: Schema.Number,
        /** Absent in judgements from before it was asked. */
        role: Schema.optional(Schema.Literals(ADDED_ROLES)),
        verdict: Schema.Literals(ADDED_VERDICTS),
        why: Schema.String,
      })
    )
  ),
  /** What else is there and adds nothing: a decorative icon, a box around one thing, a badge. */
  clutter: Schema.optional(
    Schema.Array(Schema.Struct({ what: Schema.String, why: Schema.String }))
  ),
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

/** The judge's answer as JSON Schema, with the round's skills as those a finding may name. */
const judgementSchema = (skills: readonly string[]) => {
  const string = { type: "string" };
  const strings = { items: string, type: "array" };
  return {
    additionalProperties: false,
    properties: {
      addedText: {
        items: {
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            role: { enum: ADDED_ROLES, type: "string" },
            verdict: { enum: ADDED_VERDICTS, type: "string" },
            why: string,
          },
          required: ["index", "role", "verdict", "why"],
          type: "object",
        },
        type: "array",
      },
      clutter: {
        items: {
          additionalProperties: false,
          properties: { what: string, why: string },
          required: ["what", "why"],
          type: "object",
        },
        type: "array",
      },
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
            level: { enum: LEVELS, type: "string" },
            reference: string,
            rule: string,
            skill: { enum: [...skills, "none"], type: "string" },
            title: string,
            viewport: { enum: ["desktop", "mobile", "both"], type: "string" },
          },
          required: [
            "title",
            "level",
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
            area: { enum: [...LEVELS, "overall"], type: "string" },
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
    required: [
      "summary",
      "scores",
      "findings",
      "addedText",
      "clutter",
      "fidelity",
      "strengths",
    ],
    type: "object",
  };
};

/** The skills the round's agents were told, by name. */
export const roundSkills = Effect.fn("roundSkills")(function* (round: string) {
  const { data } = yield* EvalsConfig;
  const files = yield* listDir(path.join(data.runs, round, "skills"));
  return files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
});

/** Every run of a round that was generated: `<round>/<reference>/run-<n>/run.json`. */
export const roundRuns = Effect.fn("roundRuns")(function* (round: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const found: { readonly dir: string; readonly reference: string }[] = [];
  const isDirectory = (dir: string) =>
    Effect.map(fs.stat(dir), (info) => info.type === "Directory");
  for (const reference of yield* listDir(path.join(data.runs, round))) {
    // Beside the references' directories: round.json, the report, skills/, proposals/.
    if (!(yield* isDirectory(path.join(data.runs, round, reference)))) {
      continue;
    }
    const runs = yield* listDir(path.join(data.runs, round, reference));
    for (const run of runs.filter((name) => name.startsWith("run-"))) {
      const dir = path.join(data.runs, round, reference, run);
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
      `${f.level ?? "–"} · ${f.skill} · ${f.coverage} · ${f.impact} · ${f.viewport}`,
      "",
      `- Reference: ${f.reference}`,
      `- Generated: ${f.generated}`,
      `- Rule: ${f.rule}`,
      `- Seen in: ${f.evidence}`,
      "",
    ]),
    "## Less is more",
    "",
    ...(judgement.addedText ?? []).map(
      (a) => `- #${a.index} ${a.verdict}: ${a.why}`
    ),
    ...(judgement.clutter ?? []).map((c) => `- clutter: ${c.what}: ${c.why}`),
    "",
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

/** A judgement, as the judge answers it, naming one of the round's skills in each finding. */
export const judgementAnswer = (skills: readonly string[]) => ({
  decode: Judgement,
  schema: judgementSchema(skills),
});

const judgeRun = Effect.fn("judgeRun")(function* (
  round: string,
  run: { readonly dir: string; readonly reference: string },
  skills: readonly string[],
  model: string
) {
  const { data } = yield* EvalsConfig;
  const models = yield* Models;
  const fs = yield* FileSystem.FileSystem;
  const reference = yield* loadReference(run.reference);
  const pictures = (dir: string) =>
    Effect.map(listDir(dir), (files) =>
      files
        .filter((f) => f.endsWith(".jpg") || f.endsWith(".png"))
        .map((f) => `- ${data.fromData(path.join(dir, f))}`)
        .join("\n")
    );
  const generated = yield* pictures(path.join(run.dir, "shots"));
  if (generated === "") {
    // Judged blind, a run would only be found wanting for what nobody could see.
    return yield* Effect.logWarning(
      `${data.fromData(run.dir)}: not judged: it has no pictures (its run.json says why)`
    );
  }
  const info = yield* fs.readFileString(path.join(run.dir, "run.json"));
  const added = path.join(run.dir, ADDED_TEXT_FILE);
  const content = path.join(data.captureDir(reference.id), CONTENT_FILE);
  const answer = yield* models.ask({
    cwd: data.root,
    model,
    prompt: yield* prompt("judge", {
      added: (yield* fs.exists(added))
        ? data.fromData(added)
        : "(not recorded for this run: leave addedText empty)",
      agent: data.fromData(path.join(run.dir, "agent.md")),
      brief: data.fromData(data.briefFile(reference.id)),
      content: (yield* fs.exists(content))
        ? data.fromData(content)
        : "none: a shot has only its pictures",
      generated,
      kind: reference.kind,
      name: reference.name,
      pages: data.fromData(path.join(run.dir, "pages")),
      principles: yield* fs.readFileString(path.join(PROMPTS, "principles.md")),
      reference: yield* pictures(data.captureDir(reference.id)),
      run: info,
      skills: data.fromData(path.join(data.runs, round, "skills")),
      trace: data.fromData(path.join(run.dir, "trace.md")),
      why: reference.why,
    }),
    ...judgementAnswer(skills),
  });
  const judgement = answer.value;
  yield* writeJson(path.join(run.dir, "judge.json"), {
    ...judgement,
    costUsd: answer.costUsd,
  });
  yield* writeText(path.join(run.dir, "judge.md"), render(judgement));
  const overall = judgement.scores.find((s) => s.area === "overall")?.score;
  yield* Effect.log(
    `${data.fromData(run.dir)}: ${judgement.findings.length} findings, overall ${overall ?? "?"}/5 ($${answer.costUsd.toFixed(2)})`
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
  const { data } = yield* EvalsConfig;
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
          Effect.logError(
            `${data.fromData(run.dir)}: not judged: ${String(error)}`
          )
        )
      ),
    { concurrency: options.concurrency }
  );
});

/** A run's `judge.json`: the judgement, and what it cost when that was recorded. */
const JudgeFile = Schema.Struct({
  ...Judgement.fields,
  costUsd: Schema.optional(Schema.Number),
});
export type JudgeFile = typeof JudgeFile.Type;

/** A run's judgement, when it has one. */
export const readJudgement = (dir: string) =>
  readJson(JudgeFile, path.join(dir, "judge.json"));
