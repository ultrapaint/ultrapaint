/**
 * `judge-components`: Track A's judge. Each component a run's design system drew is set beside the
 * product's own (cut from its screens) and, when an earlier round is named, beside the version the
 * person picked there; a model scores how close each is, says which is closer, and lists what
 * differs, as the screen judge does. The person reviews some of its verdicts, not every detail.
 *
 *   runs/<round>/<family>/run-N/judge-components.json, runs/<round>/components-report.md
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";

import { EvalsConfig } from "./config.ts";
import { COMPONENTS, COMPONENTS_DIR, COMPONENTS_FILE } from "./extract.ts";
import {
  listDir,
  PROMPTS,
  prompt,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";
import { Models } from "./models.ts";
import { readReview } from "./review.ts";
import { slugOf } from "./sections.ts";

const IMPACTS = ["high", "medium", "low"] as const;
const BETTER = ["new", "earlier", "same", "none"] as const;

const Finding = Schema.Struct({
  generated: Schema.String,
  impact: Schema.Literals(IMPACTS),
  reference: Schema.String,
  title: Schema.String,
});
const ComponentVerdict = Schema.Struct({
  better: Schema.Literals(BETTER),
  closeness: Schema.Number,
  findings: Schema.Array(Finding),
  name: Schema.String,
  note: Schema.String,
});
export const ComponentJudgement = Schema.Struct({
  components: Schema.Array(ComponentVerdict),
  system: Schema.Array(Finding),
});
export type ComponentJudgement = typeof ComponentJudgement.Type;

const findingSchema = {
  additionalProperties: false,
  properties: {
    generated: { type: "string" },
    impact: { enum: [...IMPACTS], type: "string" },
    reference: { type: "string" },
    title: { type: "string" },
  },
  required: ["title", "impact", "generated", "reference"],
  type: "object",
};
const judgementSchema = {
  additionalProperties: false,
  properties: {
    components: {
      items: {
        additionalProperties: false,
        properties: {
          better: { enum: [...BETTER], type: "string" },
          closeness: { maximum: 5, minimum: 1, type: "integer" },
          findings: { items: findingSchema, type: "array" },
          name: { enum: COMPONENTS.map((c) => c.name), type: "string" },
          note: { type: "string" },
        },
        required: ["name", "closeness", "better", "findings", "note"],
        type: "object",
      },
      type: "array",
    },
    system: { items: findingSchema, type: "array" },
  },
  required: ["components", "system"],
  type: "object",
};

/** A family's components judged, as the judge answers it. */
export const componentJudgementAnswer = {
  decode: ComponentJudgement,
  schema: judgementSchema,
};

const FoundKinds = Schema.Struct({
  components: Schema.Array(
    Schema.Struct({
      kind: Schema.optional(Schema.String),
      missing: Schema.Boolean,
      name: Schema.String,
    })
  ),
});

/** The run picked for a component in an earlier round: its crop, when there is one. */
const earlierCrop = Effect.fn("earlierCrop")(function* (
  against: {
    readonly round: string;
    readonly verdicts: Record<string, { readonly pick?: string | undefined }>;
  },
  family: string,
  slug: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const pick =
    against.verdicts[`component/${against.round}/${family}/${slug}`]?.pick;
  // A pick made on a card set against a round before it names its round too.
  const run = pick?.includes("/") ? pick.split("/")[1] : pick;
  const round = pick?.includes("/") ? pick.split("/")[0] : against.round;
  if (run === undefined || run === "none" || round === undefined) {
    return;
  }
  const crop = path.join(
    data.runs,
    round,
    family,
    run,
    COMPONENTS_DIR,
    `${slug}.png`
  );
  return (yield* fs.exists(crop)) ? crop : undefined;
});

/** One run of one family: its components beside the product's, judged in one call. */
const judgeFamilyRun = Effect.fn("judgeFamilyRun")(function* (
  round: string,
  family: string,
  run: string,
  options: {
    readonly against:
      | {
          readonly round: string;
          readonly verdicts: Record<
            string,
            { readonly pick?: string | undefined }
          >;
        }
      | undefined;
    readonly model: string;
  }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const kindsFile = path.join(data.familyDir(family), COMPONENTS_FILE);
  const kinds = (yield* fs.exists(kindsFile))
    ? (yield* readJson(FoundKinds, kindsFile)).components
    : [];
  const lines: string[] = [];
  for (const component of COMPONENTS) {
    const slug = slugOf(component.name);
    const made = path.join(
      data.runs,
      round,
      family,
      run,
      COMPONENTS_DIR,
      `${slug}.png`
    );
    if (!(yield* fs.exists(made))) {
      continue;
    }
    const product = path.join(
      data.familyDir(family),
      COMPONENTS_DIR,
      `${slug}.jpg`
    );
    const earlier = options.against
      ? yield* earlierCrop(options.against, family, slug)
      : undefined;
    const kind = kinds.find(
      (k) => k.name === component.name && !k.missing
    )?.kind;
    lines.push(
      [
        `- ${component.name}${kind && kind.toLowerCase() !== component.name.toLowerCase() ? ` (in this product: ${kind})` : ""}, in its states: ${component.states}`,
        `  - the agent's: \`${data.fromData(made)}\``,
        (yield* fs.exists(product))
          ? `  - the product's: \`${data.fromData(product)}\``
          : "  - the product's: not shown in its screens",
        earlier ? `  - the earlier version: \`${data.fromData(earlier)}\`` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  if (lines.length === 0) {
    return;
  }
  const answer = yield* models.ask({
    cwd: data.root,
    model: options.model,
    prompt: yield* prompt("judge-components", {
      components: lines.join("\n"),
      principles: yield* fs.readFileString(path.join(PROMPTS, "principles.md")),
      product: family,
    }),
    ...componentJudgementAnswer,
  });
  const judgement = answer.value;
  yield* writeJson(
    path.join(data.runs, round, family, run, "judge-components.json"),
    judgement
  );
  const wins = judgement.components.filter((c) => c.better === "new").length;
  const losses = judgement.components.filter(
    (c) => c.better === "earlier"
  ).length;
  const mean =
    judgement.components.reduce((n, c) => n + c.closeness, 0) /
    Math.max(1, judgement.components.length);
  yield* Effect.log(
    `${family} ${run}: closeness ${mean.toFixed(1)}/5, ${options.against ? `${wins} closer than before, ${losses} further, ` : ""}${judgement.components.reduce((n, c) => n + c.findings.length, 0)} findings ($${answer.costUsd.toFixed(2)})`
  );
  return { family, judgement, run };
});

/** Every family and run of a Track A round, judged; a report of them all. */
export const judgeComponents = Effect.fn("judgeComponents")(function* (
  round: string,
  options: {
    readonly against: string | undefined;
    readonly concurrency: number;
    readonly model: string;
  }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const against = options.against
    ? {
        round: options.against,
        verdicts: yield* readReview(options.against),
      }
    : undefined;
  const runs: { readonly family: string; readonly run: string }[] = [];
  for (const family of yield* listDir(path.join(data.runs, round))) {
    const dir = path.join(data.runs, round, family);
    if ((yield* fs.stat(dir)).type !== "Directory") {
      continue;
    }
    for (const run of (yield* listDir(dir)).filter((r) =>
      r.startsWith("run-")
    )) {
      runs.push({ family, run });
    }
  }
  const judged = (yield* Effect.forEach(
    runs,
    ({ family, run }) =>
      judgeFamilyRun(round, family, run, {
        against,
        model: options.model,
      }).pipe(
        Effect.catch((error) =>
          Effect.as(
            Effect.logError(`${family} ${run}: ${String(error)}`),
            undefined
          )
        )
      ),
    { concurrency: options.concurrency }
  )).filter((j) => j !== undefined);

  const rows = judged.map(({ family, judgement, run }) => {
    const n = judgement.components.length;
    const mean =
      judgement.components.reduce((s, c) => s + c.closeness, 0) /
      Math.max(1, n);
    const count = (b: (typeof BETTER)[number]) =>
      judgement.components.filter((c) => c.better === b).length;
    return `| ${family} | ${run} | ${mean.toFixed(1)} | ${count("new")} | ${count("same")} | ${count("earlier")} |`;
  });
  const worst = judged
    .flatMap(({ family, judgement }) =>
      judgement.components.flatMap((c) =>
        c.findings
          .filter((f) => f.impact === "high")
          .map((f) => `- ${family} · ${c.name}: ${f.title}`)
      )
    )
    .slice(0, 40);
  yield* writeText(
    path.join(data.runs, round, "components-report.md"),
    [
      `# ${round}: the components, judged${options.against ? ` against ${options.against}'s picks` : ""}`,
      "",
      "| Family | Run | Closeness (1–5) | Closer than before | Same | Further |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
      "## High-impact findings",
      "",
      ...worst,
      "",
    ].join("\n")
  );
  yield* Effect.log(
    `report: ${data.fromData(path.join(data.runs, round, "components-report.md"))}`
  );
});
