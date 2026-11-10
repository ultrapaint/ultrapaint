/**
 * `report`: a round's judgements put together. The scores are counted here; the findings of every
 * run are grouped by a model into gaps, and each gap is counted here again: in how many runs of
 * each reference it happened. A gap in every run is something the skill does not teach, or
 * teaches wrong; a gap in some runs is something it teaches that agents follow flakily.
 *
 * A gap seen in two runs or more that the skill could close is also written as a draft for
 * `evals/gaps/` (`proposals/`), with the one change to try: a change to the skill starts as a gap
 * and is measured before the skill changes (ADR 0065), so the report never writes the skill's
 * text. A person moves the drafts worth keeping into `evals/gaps/`.
 *
 * A person's review (`review.json`) overrules the judge: a finding they said is no problem is
 * left out, a text they called noise is noise, and their comments are the synthesis's first
 * evidence. "Less is more" is counted here: the texts each run added that were noise or invented.
 */
import path from "node:path";
import { DateTime, Effect, FileSystem, Schema } from "effect";
import { ADDED_TEXT_FILE, AddedTextEntry } from "./added-text.ts";
import { EvalsConfig } from "./config.ts";
import type { Gap as DesignGap } from "./gap.ts";
import { RoundInfo } from "./generate.ts";
import {
  isLevel,
  type JudgeFile,
  LEVELS,
  readJudgement,
  roundRuns,
  roundSkill,
  skillPlace,
} from "./judge.ts";
import { PROMPTS, prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";
import { readReview, scoreOf, type Verdict } from "./review.ts";
import { slugOf } from "./sections.ts";

const Gap = Schema.Struct({
  findings: Schema.Array(Schema.String),
  kind: Schema.Literals(["missing", "ignored", "misleading", "tool"]),
  level: Schema.Literals(LEVELS),
  /** What the skill says of it today, quoted with its file; empty when nothing does. */
  now: Schema.String,
  proposal: Schema.String,
  /** The skill's file that should teach it, by its path in the skill, or `none`. */
  skill: Schema.String,
  summary: Schema.String,
  /** How the lab would tell whether the proposed change works. */
  test: Schema.String,
  title: Schema.String,
});
type Gap = typeof Gap.Type;

const Synthesis = Schema.Struct({
  gaps: Schema.Array(Gap),
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
            level: { enum: LEVELS, type: "string" },
            now: string,
            proposal: string,
            skill: { enum: [...skills, "none"], type: "string" },
            summary: string,
            test: string,
            title: string,
          },
          required: [
            "title",
            "level",
            "skill",
            "kind",
            "findings",
            "summary",
            "now",
            "proposal",
            "test",
          ],
          type: "object",
        },
        type: "array",
      },
      strengths: { items: string, type: "array" },
    },
    required: ["gaps", "strengths"],
    type: "object",
  };
};

/** The gaps and their proposals, as the model answers them, naming the skill's files. */
export const synthesisAnswer = (skills: readonly string[]) => ({
  decode: Synthesis,
  schema: synthesisSchema(skills),
});

interface Judged {
  readonly added: readonly AddedTextEntry[];
  readonly judgement: JudgeFile;
  readonly reference: string;
  readonly run: string;
}

/** A text the run added, and whether it should not be there: by the person, else the judge. */
interface Unwanted {
  /** Noise says what the screen shows already; invented is content the brief did not have. */
  readonly kind: "noise" | "invented";
  readonly reference: string;
  readonly run: string;
  readonly text: string;
  readonly words: number;
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

/** Every run, some runs, or, when there was only one, nothing to tell them apart by. */
const seenIn = (gap: {
  readonly byReference: readonly unknown[];
  readonly consistent: boolean;
  readonly single: boolean;
}) => {
  if (gap.single) {
    return gap.byReference.length > 1
      ? `${gap.byReference.length} references, one run each`
      : "its one run";
  }
  return gap.consistent ? "every run" : "some runs";
};

const KIND_LABEL = {
  ignored: "the skill says it; agents do not do it",
  misleading: "the skill leads the wrong way",
  missing: "the skill does not say it",
  tool: "the tool could not do it",
} as const;

/**
 * A gap's kind as `evals/gaps/` has it. A rule that misleads is drafted as `missing`, its text
 * quoting the rule: the rule that holds is the one the skill lacks.
 */
const DRAFT_KIND = {
  ignored: "missed",
  misleading: "missing",
  missing: "missing",
} as const satisfies Record<string, DesignGap["kind"]>;

/** A gap seen in this many runs is drafted: one run's is one design's accident. */
const DRAFTED_FROM = 2;

/** A gap of a round with where it was seen. */
type SeenGap = Gap & {
  readonly byReference: readonly {
    readonly hit: number;
    readonly of: number;
    readonly reference: string;
  }[];
  readonly runsHit: number;
};

/** Whether a gap is drafted for `evals/gaps/`: the skill could close it, and it recurred. */
const isDrafted = <G extends SeenGap>(
  gap: G
): gap is G & { readonly kind: keyof typeof DRAFT_KIND } =>
  gap.kind !== "tool" && gap.runsHit >= DRAFTED_FROM;

const ONE_LINE = /\s+/g;

/**
 * A round's gap as a draft of a file of `evals/gaps/` (its README has the form): what happened,
 * what the skill says now, the one change to try and its test. It has no `id`: the person who
 * keeps it gives it the next free one, and a file moved there without one does not load.
 */
export const gapDraft = (options: {
  readonly found: string;
  readonly gap: SeenGap & { readonly kind: keyof typeof DRAFT_KIND };
  readonly round: string;
}) => {
  const { found, gap, round } = options;
  const seen = gap.byReference
    .map((r) => `${r.reference} ${r.hit}/${r.of}`)
    .join(", ");
  return `---
title: ${gap.title.replace(ONE_LINE, " ").trim()}
kind: ${DRAFT_KIND[gap.kind]}
status: open
found: ${found}
source: round ${round}, the judge's findings in ${gap.runsHit} runs (${seen})
skill: [${gap.skill === "none" ? "SKILL.md" : gap.skill}]
sections: []
---

**What happened.** ${gap.summary.trim()}

**The skill now.** ${gap.now.trim() || "No rule says it."}

**Proposed.** ${gap.proposal.trim()}

**Test.** ${gap.test.trim()}

**Result.**
`;
};

export const report = Effect.fn("report")(function* (
  round: string,
  options: { readonly model: string }
) {
  const { data } = yield* EvalsConfig;
  const models = yield* Models;
  const dir = path.join(data.runs, round);
  const info = yield* readJson(RoundInfo, path.join(dir, "round.json"));
  const skill = yield* roundSkill(round);
  const runs = yield* roundRuns(round);
  const fs = yield* FileSystem.FileSystem;
  const verdicts = yield* readReview(round);
  const verdictOf = (id: string): Verdict | undefined => verdicts[id];
  const judged: Judged[] = [];
  for (const run of runs) {
    const judgement = yield* readJudgement(run.dir).pipe(Effect.option);
    const addedFile = path.join(run.dir, ADDED_TEXT_FILE);
    if (judgement._tag === "Some") {
      judged.push({
        added: (yield* fs.exists(addedFile))
          ? yield* readJson(Schema.Array(AddedTextEntry), addedFile)
          : [],
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

  // Every finding gets an id the synthesis groups by: `linear-home/run-2#3`. One the person
  // said is no problem is left out; one they confirmed says so.
  const reviewed = judged.flatMap((j) =>
    j.judgement.findings.map((f, index) => {
      const verdict = verdictOf(
        `finding/${round}/${j.reference}/${j.run}/${index + 1}`
      );
      return {
        id: `${j.reference}/${j.run}#${index + 1}`,
        ...f,
        ...(verdict && verdict.choice !== "skip"
          ? {
              person: verdict.choice === "right" ? "confirmed" : "rejected",
              ...(verdict.comment && { personSaid: verdict.comment }),
            }
          : {}),
      };
    })
  );
  const findings = reviewed.filter((f) => f.person !== "rejected");
  const rejected = reviewed.length - findings.length;
  yield* writeJson(path.join(dir, "findings.json"), findings);

  // Less is more: what each run added beyond the brief that should not be there.
  const unwanted: Unwanted[] = judged.flatMap((j) =>
    j.added.flatMap((a) => {
      const person = verdictOf(
        `text/${round}/${j.reference}/${j.run}/${a.index}`
      );
      const judge = j.judgement.addedText?.find((x) => x.index === a.index);
      // A person who swiped it away called it noise; else the judge's word stands.
      let kind: Unwanted["kind"] | undefined;
      if (person && person.choice !== "skip") {
        kind = person.choice === "left" ? "noise" : undefined;
      } else if (judge && judge.verdict !== "needed") {
        kind = judge.verdict;
      }
      return kind
        ? [
            {
              kind,
              reference: j.reference,
              run: j.run,
              text: a.text,
              words: a.words,
            },
          ]
        : [];
    })
  );
  const notes = Object.entries(verdicts).flatMap(([id, v]) =>
    v.comment
      ? [
          `- ${id} (${v.kind}, answered ${v.choice}${v.sides ? `; left was ${v.sides[0]}, right ${v.sides[1]}` : ""}): ${v.comment}`,
        ]
      : []
  );
  yield* writeText(
    path.join(dir, "review-notes.md"),
    notes.length > 0
      ? `${notes.join("\n")}\n`
      : "No comments from a person on this round.\n"
  );
  yield* writeJson(path.join(dir, "unwanted-text.json"), unwanted);
  yield* writeJson(
    path.join(dir, "strengths.json"),
    judged.map((j) => ({
      reference: j.reference,
      run: j.run,
      strengths: j.judgement.strengths,
    }))
  );

  const answer = yield* models.ask({
    cwd: dir,
    model: options.model,
    prompt: yield* prompt("report", {
      principles: yield* fs.readFileString(path.join(PROMPTS, "principles.md")),
      references: references.map((r) => `- ${r}: ${runsOf(r)} runs`).join("\n"),
      skills: skillPlace(skill.dir, dir),
    }),
    ...synthesisAnswer(skill.names),
  });
  const synthesis = answer.value;

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
      const single = byReference.every((r) => r.of === 1);
      const high = findings.filter(
        (f) => gap.findings.includes(f.id) && f.impact === "high"
      ).length;
      return {
        ...gap,
        byReference,
        consistent,
        high,
        runsHit: runsHit.size,
        single,
      };
    })
    .sort((a, b) => b.runsHit - a.runsHit || b.high - a.high);

  yield* writeJson(path.join(dir, "gaps.json"), counted);
  const found = DateTime.formatIsoDateUtc(yield* DateTime.now);
  // Numbered in the report's order, so two gaps with one title are two files.
  const drafts = counted.filter(isDrafted).map((gap, index) => ({
    file: `${String(index + 1).padStart(2, "0")}-${slugOf(gap.title).slice(0, 48)}.md`,
    gap,
  }));
  for (const draft of drafts) {
    yield* writeText(
      path.join(dir, "proposals", draft.file),
      gapDraft({ found, gap: draft.gap, round })
    );
  }

  // Scored by level since the levels came; older rounds were scored by skill.
  const scored = new Set(
    judged.flatMap((j) => j.judgement.scores.map((s) => s.area))
  );
  const areas = [
    ...LEVELS.filter((l) => scored.has(l)),
    ...skill.names.filter((s) => scored.has(s) && !isLevel(s)),
    "overall",
  ];
  const unwantedOf = (reference?: string, kind?: Unwanted["kind"]) =>
    unwanted.filter(
      (u) =>
        (reference === undefined || u.reference === reference) &&
        (kind === undefined || u.kind === kind)
    );
  const perRun = (count: number, reference?: string) =>
    (
      count / Math.max(1, reference ? runsOf(reference) : judged.length)
    ).toFixed(1);
  const addedOf = (reference?: string) =>
    judged
      .filter((j) => reference === undefined || j.reference === reference)
      .reduce((n, j) => n + j.added.length, 0);
  const lessIsMoreRow = (label: string, reference?: string) => {
    const noise = unwantedOf(reference, "noise");
    const words = noise.reduce((n, u) => n + u.words, 0);
    return `| ${label} | ${perRun(addedOf(reference), reference)} | ${perRun(noise.length, reference)} | ${perRun(words, reference)} | ${perRun(unwantedOf(reference, "invented").length, reference)} |`;
  };
  /** The person's ratings of a reference's screens, 1 to 5. */
  const rated = (reference: string) =>
    Object.entries(verdicts).flatMap(([id, v]) => {
      const score = scoreOf(v);
      return id.startsWith("screen/") &&
        v.reference === reference &&
        score !== undefined
        ? [score]
        : [];
    });
  const reviewedScreens = Object.keys(verdicts).some((id) =>
    id.startsWith("screen/")
  );
  const scoresOf = (area: string, reference?: string) =>
    judged
      .filter((j) => reference === undefined || j.reference === reference)
      .flatMap((j) =>
        j.judgement.scores.filter((s) => s.area === area).map((s) => s.score)
      );
  const judgeCost = judged.reduce(
    (sum, j) => sum + (j.judgement.costUsd ?? 0),
    0
  );

  const lines = [
    `# Round ${info.name}`,
    "",
    `- Agent: ${info.agent}${info.model ? `, ${info.model}` : ""}; commit ${info.commit}; started ${info.startedAt}`,
    `- Host: ${info.host ?? "none recorded"}; skills: ${info.skills}`,
    `- ${judged.length} runs judged: ${references.map((r) => `${r} ×${runsOf(r)}`).join(", ")}`,
    `- Judging and this report cost $${(judgeCost + answer.costUsd).toFixed(2)}`,
    "",
    "## Scores",
    "",
    "By level, mean over the runs, out of 5; the range when runs disagree, ⚠ when by 2 or more: what agents do flakily.",
    "",
    `| Area | All | ${references.join(" | ")} |`,
    `| --- | --- | ${references.map(() => "---").join(" | ")} |`,
    ...areas.map(
      (area) =>
        `| ${area} | ${scoreCell(scoresOf(area))} | ${references.map((r) => scoreCell(scoresOf(area, r))).join(" | ")} |`
    ),
    "",
    "## Less is more",
    "",
    "Texts the page showed that the brief did not have, per run: noise (it says what the screen already shows) and invented content (data or copy the brief did not have), by the person where they reviewed it, else by the judge.",
    "",
    "| Reference | Added | Noise | Noise words | Invented |",
    "| --- | --- | --- | --- | --- |",
    lessIsMoreRow("All"),
    ...references.map((r) => lessIsMoreRow(r, r)),
    "",
    ...(["noise", "invented"] as const).flatMap((kind) => {
      const examples = unwantedOf(undefined, kind).slice(0, 15);
      return examples.length > 0
        ? [
            `${kind === "noise" ? "Noise" : "Invented"}:`,
            "",
            ...examples.map((u) => `- ${u.reference}/${u.run}: “${u.text}”`),
            "",
          ]
        : [];
    }),
    ...(reviewedScreens
      ? [
          "## What a person said",
          "",
          `How good each screen is, 1 to 5, as the person rated it and as the judge did (overall): where they part, the judge's taste is not the person's. ${rejected} of the judge's findings were rejected and left out. Comments: [review-notes.md](review-notes.md).`,
          "",
          "| Reference | Person | Judge |",
          "| --- | --- | --- |",
          ...references.map(
            (r) =>
              `| ${r} | ${scoreCell(rated(r))} | ${scoreCell(scoresOf("overall", r))} |`
          ),
          "",
        ]
      : []),
    "## Gaps",
    "",
    "Most often first. *Every run* means some reference showed it in all its runs: the skill does not teach it. *Some runs* means agents get it right sometimes: the skill teaches it too weakly to hold.",
    "",
    "| Gap | Level | The skill's file | Why | Seen | Runs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...counted.map(
      (gap) =>
        `| ${gap.title} | ${gap.level} | ${gap.skill} | ${KIND_LABEL[gap.kind]} | ${seenIn(gap)} | ${gap.byReference.map((r) => `${r.reference} ${r.hit}/${r.of}`).join(", ")} |`
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
    "## Proposed gaps",
    "",
    drafts.length === 0
      ? `None this round: no gap the skill could close was seen in ${DRAFTED_FROM} runs.`
      : [
          `Each gap seen in ${DRAFTED_FROM} runs or more that the skill could close, drafted in \`proposals/\` as a file of \`evals/gaps/\`: a change to the skill starts as a gap and is measured before the skill changes (ADR 0065), so nothing here is the skill's text. Move the ones worth keeping into \`evals/gaps/\` under the next free id (\`pnpm evals gaps\`), as the file's \`id\` and the start of its name; evals/gaps/README.md says how one is then measured.`,
          "",
          ...drafts.map(
            ({ file, gap }) =>
              `- [${gap.title}](proposals/${file}): ${gap.skill === "none" ? "SKILL.md" : gap.skill}, ${gap.runsHit} runs`
          ),
        ].join("\n"),
    "",
  ];
  yield* writeText(path.join(dir, "report.md"), lines.join("\n"));
  yield* Effect.log(`report: ${data.fromData(path.join(dir, "report.md"))}`);
});
