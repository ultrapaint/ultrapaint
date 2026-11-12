/**
 * `variety`: how alike a round's runs of one brief are (ADR 0082). A skill that gives every
 * product the same page is weaker than its pairwise wins show, so each brief with two runs or more
 * goes to one model with the runs' first screens, which rates how alike they are and says what they
 * share. Kept in `runs/<round>/variety.json`; the log gives the mean per round.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { listDir, prompt, readJson, writeJson } from "./layout.ts";
import { Models } from "./models.ts";

export const Alike = Schema.Struct({
  /** 1: unrelated pages; 3: one template varied; 5: the same page with other words. */
  alike: Schema.Number,
  /** What two or more runs share: a layout, a palette, a hero, a device. */
  shared: Schema.Array(Schema.String),
});
export type Alike = typeof Alike.Type;

const alikeAnswer = {
  decode: Alike,
  schema: {
    additionalProperties: false,
    properties: {
      alike: { enum: [1, 2, 3, 4, 5], type: "number" },
      shared: { items: { type: "string" }, type: "array" },
    },
    required: ["alike", "shared"],
    type: "object",
  },
};

const Results = Schema.Record(Schema.String, Alike);

/** A run's first screens, desktop then phone, as the prompt lists them. */
const firstScreens = Effect.fnUntraced(function* (run: string) {
  const { data } = yield* EvalsConfig;
  const shots = path.join(run, "shots");
  return (yield* listDir(shots))
    .filter((f) => f === "desktop-fold.jpg" || f === "mobile-fold.jpg")
    .map((f) => `\`${data.fromData(path.join(shots, f))}\``)
    .join(", ");
});

/** The mean of a round's ratings, to one decimal. */
export const meanAlike = (results: Readonly<Record<string, Alike>>) => {
  const all = Object.values(results).map((r) => r.alike);
  return all.length === 0
    ? undefined
    : Math.round((all.reduce((n, a) => n + a, 0) / all.length) * 10) / 10;
};

export const variety = Effect.fn("variety")(function* (
  round: string,
  options: { readonly model: string }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const out = path.join(data.runs, round);
  const file = path.join(out, "variety.json");
  const results: Record<string, Alike> = (yield* fs.exists(file))
    ? { ...(yield* readJson(Results, file)) }
    : {};
  for (const reference of yield* listDir(out)) {
    const at = path.join(out, reference);
    // A round's directory holds its reports beside the references' runs.
    if (
      results[reference] !== undefined ||
      (yield* fs.stat(at)).type !== "Directory"
    ) {
      continue;
    }
    const runs: string[] = [];
    for (const run of yield* listDir(at)) {
      const screens = yield* firstScreens(path.join(at, run));
      if (run.startsWith("run-") && screens !== "") {
        runs.push(`- ${run}: ${screens}`);
      }
    }
    if (runs.length < 2) {
      continue;
    }
    const answer = yield* models
      .ask({
        cwd: data.root,
        effort: "high",
        model: options.model,
        prompt: yield* prompt("variety", {
          brief: data.fromData(data.briefFile(reference)),
          runs: runs.join("\n"),
        }),
        ...alikeAnswer,
      })
      .pipe(
        // A brief the model could not answer for is left out; the next call asks again.
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning(`${reference}: not rated: ${String(error)}`),
            undefined
          )
        )
      );
    if (answer === undefined) {
      continue;
    }
    results[reference] = answer.value;
    yield* writeJson(file, results);
    yield* Effect.log(
      `${reference}: ${answer.value.alike} of 5 (${runs.length} runs)`
    );
  }
  yield* Effect.log(
    `${round}: runs of one brief are ${meanAlike(results) ?? "–"} of 5 alike, over ${Object.keys(results).length} briefs`
  );
});
