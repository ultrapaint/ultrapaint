/**
 * `report`: a round's judgements put together. The scores are counted here; the findings of every
 * run are grouped by a model into gaps, and each gap is counted here again: in how many runs of
 * each reference it happened. A gap in every run is something the skills do not teach, or teach
 * wrong; a gap in some runs is something they teach that agents follow flakily.
 *
 * The model also proposes skill files for the gaps worth fixing. They are proposals: a person
 * reads them, puts the ones worth trying in `candidates/<name>/`, and runs a round with
 * `--skills candidates/<name>` to see whether they help.
 */
import path from "node:path";
import { Effect, Schema } from "effect";
import { Claude } from "./claude.ts";
import { RoundInfo } from "./generate.ts";
import {
  type Judgement,
  readJudgement,
  roundRuns,
  roundSkills,
} from "./judge.ts";
import {
  fromLab,
  prompt,
  RUNS,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";

const Gap = Schema.Struct({
  findings: Schema.Array(Schema.String),
  kind: Schema.Literals(["missing", "ignored", "misleading", "tool"]),
  proposal: Schema.String,
  skill: Schema.String,
  summary: Schema.String,
  title: Schema.String,
});

const Synthesis = Schema.Struct({
  gaps: Schema.Array(Gap),
  rewrites: Schema.Array(
    Schema.Struct({
      skill: Schema.String,
      text: Schema.String,
      why: Schema.String,
    })
  ),
  strengths: Schema.Array(Schema.String),
});

const synthesisSchema = (skills: readonly string[]) => {
  const string = { type: "string" };
  return {
    additionalProperties: false,
    properties: {
      gaps: {
        items: {
          additionalProperties: false,
          properties: {
            findings: { items: string, type: "array" },
            kind: {
              enum: ["missing", "ignored", "misleading", "tool"],
              type: "string",
            },
            proposal: string,
            skill: { enum: [...skills, "none"], type: "string" },
            summary: string,
            title: string,
          },
          required: [
            "title",
            "skill",
            "kind",
            "findings",
            "summary",
            "proposal",
          ],
          type: "object",
        },
        type: "array",
      },
      rewrites: {
        items: {
          additionalProperties: false,
          properties: {
            skill: { enum: skills, type: "string" },
            text: string,
            why: string,
          },
          required: ["skill", "text", "why"],
          type: "object",
        },
        type: "array",
      },
      strengths: { items: string, type: "array" },
    },
    required: ["gaps", "rewrites", "strengths"],
    type: "object",
  };
};

interface Judged {
  readonly judgement: Judgement;
  readonly reference: string;
  readonly run: string;
}

const mean = (values: readonly number[]) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

/** `3.7 (3–5)`: the mean over the runs, and their spread when they disagree. */
const scoreCell = (values: readonly number[]) => {
  if (values.length === 0) {
    return "–";
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = low === high ? "" : ` (${low}–${high})`;
  return `${mean(values).toFixed(1)}${spread}${high - low >= 2 ? " ⚠" : ""}`;
};

const KIND_LABEL = {
  ignored: "the skill says it; agents do not do it",
  misleading: "the skill leads the wrong way",
  missing: "no skill says it",
  tool: "the tool could not do it",
} as const;

export const report = Effect.fn("report")(function* (
  round: string,
  options: { readonly model: string }
) {
  const claude = yield* Claude;
  const dir = path.join(RUNS, round);
  const info = yield* readJson(RoundInfo, path.join(dir, "round.json"));
  const skills = yield* roundSkills(round);
  const runs = yield* roundRuns(round);
  const judged: Judged[] = [];
  for (const run of runs) {
    const judgement = yield* readJudgement(run.dir).pipe(Effect.option);
    if (judgement._tag === "Some") {
      judged.push({
        judgement: judgement.value,
        reference: run.reference,
        run: path.basename(run.dir),
      });
    }
  }
  if (judged.length === 0) {
    return yield* Effect.logWarning(`${round}: nothing judged yet`);
  }
  const references = [...new Set(judged.map((j) => j.reference))];
  const runsOf = (reference: string) =>
    judged.filter((j) => j.reference === reference).length;

  // Every finding gets an id the synthesis groups by: `linear-home/run-2#3`.
  const findings = judged.flatMap((j) =>
    j.judgement.findings.map((f, index) => ({
      id: `${j.reference}/${j.run}#${index + 1}`,
      ...f,
    }))
  );
  yield* writeJson(path.join(dir, "findings.json"), findings);
  yield* writeJson(
    path.join(dir, "strengths.json"),
    judged.map((j) => ({
      reference: j.reference,
      run: j.run,
      strengths: j.judgement.strengths,
    }))
  );

  const answer = yield* claude.ask({
    cwd: dir,
    model: options.model,
    prompt: yield* prompt("report", {
      references: references.map((r) => `- ${r}: ${runsOf(r)} runs`).join("\n"),
    }),
    schema: synthesisSchema(skills),
  });
  const synthesis = yield* Schema.decodeUnknownEffect(Synthesis)(
    answer.structured
  );

  /** In how many runs of each reference a gap was seen. */
  const counted = synthesis.gaps
    .map((gap) => {
      const runsHit = new Set(gap.findings.map((id) => id.split("#")[0] ?? id));
      const byReference = references.flatMap((reference) => {
        const hit = [...runsHit].filter((r) =>
          r.startsWith(`${reference}/`)
        ).length;
        return hit > 0 ? [{ hit, of: runsOf(reference), reference }] : [];
      });
      const consistent = byReference.some((r) => r.hit === r.of && r.of > 1);
      const high = findings.filter(
        (f) => gap.findings.includes(f.id) && f.impact === "high"
      ).length;
      return { ...gap, byReference, consistent, high, runsHit: runsHit.size };
    })
    .sort((a, b) => b.runsHit - a.runsHit || b.high - a.high);

  yield* writeJson(path.join(dir, "gaps.json"), counted);
  for (const rewrite of synthesis.rewrites) {
    yield* writeText(
      path.join(dir, "proposals", `${rewrite.skill}.md`),
      `${rewrite.text.trim()}\n`
    );
  }

  const areas = [...skills, "overall"];
  const scoresOf = (area: string, reference?: string) =>
    judged
      .filter((j) => reference === undefined || j.reference === reference)
      .flatMap((j) =>
        j.judgement.scores.filter((s) => s.area === area).map((s) => s.score)
      );
  const judgeCost = judged.reduce(
    (sum, j) => sum + ((j.judgement as { costUsd?: number }).costUsd ?? 0),
    0
  );

  const lines = [
    `# Round ${info.name}`,
    "",
    `- Agent: ${info.agent}${info.model ? `, ${info.model}` : ""}; commit ${info.commit}; started ${info.startedAt}`,
    `- Skills: ${info.skills}`,
    `- ${judged.length} runs judged: ${references.map((r) => `${r} ×${runsOf(r)}`).join(", ")}`,
    `- Judging and this report cost $${(judgeCost + answer.costUsd).toFixed(2)}`,
    "",
    "## Scores",
    "",
    "Mean over the runs, out of 5; the range when runs disagree, ⚠ when by 2 or more: what agents do flakily.",
    "",
    `| Area | All | ${references.join(" | ")} |`,
    `| --- | --- | ${references.map(() => "---").join(" | ")} |`,
    ...areas.map(
      (area) =>
        `| ${area} | ${scoreCell(scoresOf(area))} | ${references.map((r) => scoreCell(scoresOf(area, r))).join(" | ")} |`
    ),
    "",
    "## Gaps",
    "",
    "Most often first. *Every run* means some reference showed it in all its runs: the skill does not teach it. *Some runs* means agents get it right sometimes: the skill teaches it too weakly to hold.",
    "",
    "| Gap | Skill | Why | Seen | Runs |",
    "| --- | --- | --- | --- | --- |",
    ...counted.map(
      (gap) =>
        `| ${gap.title} | ${gap.skill} | ${KIND_LABEL[gap.kind]} | ${gap.consistent ? "every run" : "some runs"} | ${gap.byReference.map((r) => `${r.reference} ${r.hit}/${r.of}`).join(", ")} |`
    ),
    "",
    ...counted.flatMap((gap) => [
      `### ${gap.title}`,
      "",
      gap.summary,
      "",
      `**Proposal (${gap.skill}):** ${gap.proposal}`,
      "",
      `Findings: ${gap.findings.join(", ")}`,
      "",
    ]),
    "## What agents already do well",
    "",
    ...synthesis.strengths.map((s) => `- ${s}`),
    "",
    "## Proposed skill files",
    "",
    synthesis.rewrites.length === 0
      ? "None this round."
      : [
          "Whole replacements of the shipped skill, in `proposals/`. To try one, copy it to `candidates/<name>/` and run a round with `--skills candidates/<name>`, then `compare` the two rounds.",
          "",
          ...synthesis.rewrites.map(
            (r) => `- [${r.skill}](proposals/${r.skill}.md): ${r.why}`
          ),
        ].join("\n"),
    "",
  ];
  yield* writeText(path.join(dir, "report.md"), lines.join("\n"));
  yield* Effect.log(`report: ${fromLab(path.join(dir, "report.md"))}`);
});
