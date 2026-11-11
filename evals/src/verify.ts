/**
 * `verify`: a skeptic for a recall round's reviews. Each saved review's findings go to a model that
 * did not write them, with the section's pictures, its code and the skill's rules, and it tries to
 * knock each one down: confirmed when it can point at what shows it, refuted otherwise. Only what
 * survives would reach a designer.
 *
 * Whether that is worth it is read from what the round already knows: a finding the judges matched
 * with a gap is one the person found, so refuting it costs recall; a finding of a problem the
 * person rated in the round's deck (`rate-<round>`) is real or noise, so refuting noise is what the
 * skeptic is for. It writes `verify@<skeptic>.json` beside each review, kept on a second call, and
 * `runs/<round>/verify.md`.
 */
import path from "node:path";
import { toldRules } from "@ultrapaint/contracts/review";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { Answers } from "./decide.ts";
import { EvalsError } from "./errors.ts";
import { listDir, prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";
import {
  Judgement,
  REVIEW_TABLE,
  Review,
  rateDeckName,
  ratingId,
  Saved,
  Section,
  settleJudgements,
  Unmatched,
} from "./recall.ts";
import { percent } from "./recall-stats.ts";

export const SKEPTIC_VERDICTS = ["confirmed", "refuted"] as const;
const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;

export const Verdicts = Schema.Struct({
  verdicts: Schema.Array(
    Schema.Struct({
      evidence: Schema.String,
      /** The finding's number in the review, from 1. */
      n: Schema.Number,
      severity: Schema.Literals(SEVERITIES),
      verdict: Schema.Literals(SKEPTIC_VERDICTS),
    })
  ),
});
export type Verdicts = typeof Verdicts.Type;

const verdictsAnswer = {
  decode: Verdicts,
  schema: {
    additionalProperties: false,
    properties: {
      verdicts: {
        items: {
          additionalProperties: false,
          properties: {
            evidence: { type: "string" },
            n: { type: "integer" },
            severity: { enum: [...SEVERITIES], type: "string" },
            verdict: { enum: [...SKEPTIC_VERDICTS], type: "string" },
          },
          required: ["n", "verdict", "evidence", "severity"],
          type: "object",
        },
        type: "array",
      },
    },
    required: ["verdicts"],
    type: "object",
  },
};

const RecallRecord = Schema.Struct({
  models: Schema.Array(Schema.String),
});

/** The model that wrote a version's reviews: after `@` in its name, else the round's only one. */
export const reviewerOf = (version: string, models: readonly string[]) => {
  const at = version.indexOf("@");
  if (at < 0) {
    return models[0];
  }
  const rest = version.slice(at + 1);
  const plus = rest.indexOf("+");
  return plus < 0 ? rest : rest.slice(0, plus);
};

const VERSION_PARTS_RE = /[@+]/;

/** The skill's tree a version was reviewed with: its name before `@` or `+`. */
export const treeOf = (version: string) =>
  version.split(VERSION_PARTS_RE)[0] ?? version;

/** What the person said of the problems a finding is grouped in: noise outweighs real. */
const ratingOf = (choices: readonly (string | undefined)[]) => {
  if (choices.includes("noise")) {
    return "noise" as const;
  }
  return choices.includes("real") ? ("real" as const) : undefined;
};

/** The first skeptic that is not the review's own model; none when every one is. */
export const skepticFor = (
  reviewer: string | undefined,
  skeptics: readonly string[]
) => skeptics.find((s) => s !== reviewer);

/** What one finding was: matched with a gap, part of a problem the person rated, or neither. */
export interface FindingFate {
  readonly gap: boolean;
  readonly rating: "real" | "noise" | undefined;
  readonly verdict: (typeof SKEPTIC_VERDICTS)[number] | undefined;
}

interface Counts {
  readonly confirmed: number;
  readonly findings: number;
  readonly gapKept: number;
  readonly gapMatched: number;
  readonly noise: number;
  readonly noiseRefuted: number;
  readonly real: number;
  readonly realKept: number;
}

export const countFates = (fates: readonly FindingFate[]): Counts => {
  const judged = fates.filter((f) => f.verdict !== undefined);
  const kept = (f: FindingFate) => f.verdict === "confirmed";
  return {
    confirmed: judged.filter(kept).length,
    findings: judged.length,
    gapKept: judged.filter((f) => f.gap && kept(f)).length,
    gapMatched: judged.filter((f) => f.gap).length,
    noise: judged.filter((f) => f.rating === "noise").length,
    noiseRefuted: judged.filter((f) => f.rating === "noise" && !kept(f)).length,
    real: judged.filter((f) => f.rating === "real").length,
    realKept: judged.filter((f) => f.rating === "real" && kept(f)).length,
  };
};

const share = (a: number, n: number) =>
  n === 0 ? "–" : `${a}/${n} · ${percent(a / n)}`;

/** The report: per version, what the skeptic kept of each kind of finding. */
export const verifyReport = (
  round: string,
  rows: readonly { readonly counts: Counts; readonly version: string }[],
  rated: number
) =>
  [
    `# Verify: ${round}`,
    "",
    "A skeptic that did not write the review tried to knock down each finding. A finding the judges matched with a gap is one the person found: refuting it costs recall. A finding of a problem the person rated is real or noise: refuting noise is what the skeptic is for.",
    "",
    "| Version | Findings | Kept | Gap findings kept | Real kept | Noise refuted |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      ({ counts: c, version }) =>
        `| ${version} | ${c.findings} | ${share(c.confirmed, c.findings)} | ${share(c.gapKept, c.gapMatched)} | ${share(c.realKept, c.real)} | ${share(c.noiseRefuted, c.noise)} |`
    ),
    "",
    rated === 0
      ? `Nothing of \`${rateDeckName(round)}\` is rated yet: “Real kept” and “Noise refuted” fill in once it is (\`pnpm evals decide ${rateDeckName(round)}\`, then \`pnpm evals verify ${round}\` again, which asks no model twice).`
      : `${rated} problems of \`${rateDeckName(round)}\` are rated; a finding counts once for each problem it is grouped in.`,
    "",
  ].join("\n");

const listed = (review: Review) =>
  review.findings
    .map(
      (f, i) =>
        `${i + 1}. **${f.title}** (${f.where}): ${f.problem} Fix: ${f.fix}`
    )
    .join("\n");

export const verify = Effect.fn("verify")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  readonly round: string;
  readonly skeptics: readonly string[];
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const out = path.join(data.runs, options.round);
  if (!(yield* fs.exists(path.join(out, "recall.json")))) {
    return yield* new EvalsError({
      message: `${options.round} is not a recall round: no recall.json`,
    });
  }
  const { models: reviewers } = yield* readJson(
    RecallRecord,
    path.join(out, "recall.json")
  );
  const answersFile = path.join(
    data.root,
    "decisions",
    `${rateDeckName(options.round)}.answers.json`
  );
  const answers = (yield* fs.exists(answersFile))
    ? yield* readJson(Answers, answersFile)
    : {};

  const jobs: {
    readonly dir: string;
    readonly run: string;
    readonly section: string;
    readonly version: string;
  }[] = [];
  for (const section of yield* listDir(out)) {
    if (
      !(yield* fs.exists(path.join(data.sections, section, "section.json")))
    ) {
      continue;
    }
    for (const version of yield* listDir(path.join(out, section))) {
      const at = path.join(out, section, version);
      if ((yield* fs.stat(at)).type !== "Directory") {
        continue;
      }
      for (const run of yield* listDir(at)) {
        // A model the round no longer reviews with left reviews behind: they are not its.
        const ofRound = reviewers.includes(
          reviewerOf(version, reviewers) ?? ""
        );
        if (ofRound && (yield* fs.exists(path.join(at, run, "review.json")))) {
          jobs.push({ dir: path.join(at, run), run, section, version });
        }
      }
    }
  }

  const fates = yield* Effect.forEach(
    jobs,
    (job) =>
      Effect.gen(function* () {
        const reviewer = reviewerOf(job.version, reviewers);
        const skeptic = skepticFor(reviewer, options.skeptics);
        if (skeptic === undefined) {
          return [];
        }
        const review = (yield* readJson(
          Saved(Review),
          path.join(job.dir, "review.json")
        )).value;
        if (review.findings.length === 0) {
          return [];
        }
        const file = path.join(
          job.dir,
          `verify@${skeptic.replaceAll(/[^\w.-]/g, "-")}.json`
        );
        const verdicts = (yield* fs.exists(file))
          ? yield* readJson(Verdicts, file)
          : yield* Effect.gen(function* () {
              const section = yield* readJson(
                Section,
                path.join(data.sections, job.section, "section.json")
              );
              const tree = path.join(out, "skills", treeOf(job.version));
              const table = path.join(tree, REVIEW_TABLE);
              const answer = yield* models.ask({
                cwd: path.join(out, "sections", job.section),
                effort: options.effort,
                images: section.pictures.map((p) => p.file),
                model: skeptic,
                prompt: yield* prompt("verify-findings", {
                  code: section.code.map((f) => `- \`${f}\``).join("\n"),
                  findings: listed(review),
                  name: section.name,
                  pictures: section.pictures
                    .map((p) => `- \`${p.file}\`: ${p.shows}`)
                    .join("\n"),
                  rules: toldRules(
                    yield* fs.readFileString(path.join(tree, "SKILL.md")),
                    (yield* fs.exists(table))
                      ? yield* fs.readFileString(table)
                      : undefined
                  ),
                  where: section.where,
                }),
                ...verdictsAnswer,
              });
              yield* writeJson(file, answer.value);
              yield* Effect.log(
                `${job.section} ${job.version} ${job.run}: ${answer.value.verdicts.filter((v) => v.verdict === "confirmed").length} of ${review.findings.length} kept by ${skeptic}`
              );
              return answer.value;
            });

        const judgements: Judgement[] = [];
        for (const name of yield* listDir(job.dir)) {
          if (name.startsWith("judgement")) {
            judgements.push(
              (yield* readJson(Saved(Judgement), path.join(job.dir, name)))
                .value
            );
          }
        }
        const matched = new Set(
          (settleJudgements(judgements)?.gaps ?? [])
            .filter((g) => g.verdict !== "missed")
            .flatMap((g) => g.findings)
        );
        const unmatchedFile = path.join(out, job.section, "unmatched.json");
        const problems = (yield* fs.exists(unmatchedFile))
          ? (yield* readJson(Saved(Unmatched), unmatchedFile)).value.problems
          : [];
        return review.findings.map(
          (
            _,
            i
          ): FindingFate & {
            readonly version: string;
          } => {
            const key = `${job.version}/${job.run}#${i + 1}`;
            const ratings = problems
              .filter((p) => p.findings.includes(key))
              .map((p) => answers[ratingId(job.section, p.title)]?.choice);
            return {
              gap: matched.has(i + 1),
              rating: ratingOf(ratings),
              verdict: verdicts.verdicts.find((v) => v.n === i + 1)?.verdict,
              version: job.version,
            };
          }
        );
      }).pipe(
        Effect.catchTag("EvalsError", (error) =>
          Effect.as(
            Effect.logWarning(
              `${job.section} ${job.version} ${job.run}: not verified: ${error.message}`
            ),
            []
          )
        )
      ),
    { concurrency: options.concurrency }
  );
  const all = fates.flat();
  const versions = [...new Set(all.map((f) => f.version))].sort();
  const text = verifyReport(
    options.round,
    versions.map((version) => ({
      counts: countFates(all.filter((f) => f.version === version)),
      version,
    })),
    Object.values(answers).filter(
      (a) => a.choice === "real" || a.choice === "noise"
    ).length
  );
  yield* writeText(path.join(out, "verify.md"), text);
  yield* Effect.log(`report: ${data.fromData(path.join(out, "verify.md"))}`);
});
