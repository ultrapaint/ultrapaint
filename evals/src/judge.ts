/**
 * `judge`: each run of a round looked at beside its reference by a model acting as a senior
 * designer. It scores the run at every level of design (layout, hierarchy, components, restraint…)
 * and lists where the run is worse than the reference, each at its level and tied to the file of
 * the design skill that should have prevented it (ADR 0069: one skill, a core and its references)
 * and to whether the skill says so: the rule is missing, the rule is there and was not followed,
 * the rule leads the wrong way, or the tool could not do it.
 *
 * It also says, of every text the page shows that the brief did not, whether it is noise, content
 * the agent invented, or needed: what "less is more" is counted with.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { ADDED_TEXT_FILE } from "./added-text.ts";
import { CONTENT_FILE } from "./capture.ts";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import {
  listDir,
  PROMPTS,
  prompt,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";
import { Models } from "./models.ts";
import { SkillTree, skillFilesOf } from "./recall.ts";
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
  /**
   * The skill's file whose subject it is, by its path in the skill (`SKILL.md`,
   * `references/kinds/dialog.md`), or `none`; a skill's name in rounds from before the one skill.
   */
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

/** The judge's answer as JSON Schema, with the skill's files as those a finding may name. */
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

/** The part of a round's record that says which skill it ran with. */
const RoundSkill = Schema.Struct({ skillTree: Schema.optional(SkillTree) });

const CORE = "SKILL.md";

/** A skill's files as a finding names them: the core first. */
const coreFirst = (files: readonly string[]) => [
  ...files.filter((f) => f === CORE),
  ...files.filter((f) => f !== CORE),
];

/**
 * The skill a round's agents were taught, as the judge and the report read it: where it is, and
 * what a finding may name of it. A round records its skill tree (`round.json`'s `skillTree`): a
 * finding names one of its files, the core first. A round from before that record that wrote a
 * tree (an outside round's `skills/<version>/`) is read from the tree. One from before the one
 * skill has its skills one file each in `skills/`, and a finding names one of them, as it did.
 * A round run with no skill has none of these.
 */
export const roundSkill = Effect.fn("roundSkill")(function* (round: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = path.join(data.runs, round);
  const record = path.join(dir, "round.json");
  const tree = (yield* fs.exists(record))
    ? (yield* readJson(RoundSkill, record)).skillTree
    : undefined;
  if (tree !== undefined) {
    return {
      dir: path.join(dir, tree.dir),
      names: coreFirst(Object.keys(tree.files).sort()),
    };
  }
  const skills = path.join(dir, "skills");
  const kept = yield* listDir(skills);
  const isFile = (name: string) => name.endsWith(".md");
  for (const name of kept.filter((n) => !isFile(n))) {
    const written = path.join(skills, name);
    // Anything there that is no directory holds no core.
    const core = fs.exists(path.join(written, CORE));
    if (yield* Effect.orElseSucceed(core, () => false)) {
      return { dir: written, names: coreFirst(yield* skillFilesOf(written)) };
    }
  }
  const names = kept.filter(isFile).map((f) => f.slice(0, -3));
  return { dir: names.length > 0 ? skills : undefined, names };
});

/**
 * Where a round's skill is, for a command that sets a study against it: the round's name, or a
 * directory by its whole path. A round that ran with no skill has none to set anything against.
 */
export const skillDirOf = Effect.fn("skillDirOf")(function* (from: string) {
  if (path.isAbsolute(from)) {
    return from;
  }
  const { dir } = yield* roundSkill(from);
  return dir === undefined
    ? yield* new EvalsError({
        message: `round ${from} recorded no skill: name a round that ran with one, or a directory by its whole path`,
      })
    : dir;
});

/** What a finding of a round may name: the files of its skill, or its skills in an older round. */
export const roundSkills = (round: string) =>
  Effect.map(roundSkill(round), (skill) => skill.names);

/**
 * Where the judge and the report are told the skill is, from the directory they work in, or that
 * the round had none.
 */
export const skillPlace = (dir: string | undefined, from: string) =>
  dir === undefined
    ? "no directory (this round's agents were given no skill: every `skill` is `none`, and the rest of this step does not apply)"
    : `\`${path.relative(from, dir)}\``;

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

/** A judgement, as the judge answers it, naming one of the skill's files in each finding. */
export const judgementAnswer = (skills: readonly string[]) => ({
  decode: Judgement,
  schema: judgementSchema(skills),
});

const judgeRun = Effect.fn("judgeRun")(function* (
  run: { readonly dir: string; readonly reference: string },
  skill: {
    readonly dir: string | undefined;
    readonly names: readonly string[];
  },
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
      skills: skillPlace(skill.dir, data.root),
      trace: data.fromData(path.join(run.dir, "trace.md")),
      why: reference.why,
    }),
    ...judgementAnswer(skill.names),
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
  const skill = yield* roundSkill(round);
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
      judgeRun(run, skill, options.model).pipe(
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
