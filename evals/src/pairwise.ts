/**
 * `pairwise`: two rounds judged blind, run by run. For each reference and run both rounds have,
 * the judge sees the reference and the two designs under letters the run's name shuffles, and
 * says which is better, level by level. The verdicts are kept under the rounds' names in
 * `runs/<a>-vs-<b>/pairwise.json`, so a run judged once is not asked again; `reads.json` beside
 * it lists the skill's files each run opened.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { Claude } from "./claude.ts";
import {
  captureDir,
  DATA,
  fromData,
  listDir,
  PROMPTS,
  prompt,
  RUNS,
  readJson,
  writeJson,
} from "./layout.ts";

const LEVELS = [
  "layout",
  "hierarchy",
  "restraint",
  "typography",
  "colour",
  "spacing",
  "components",
] as const;
const SIDES = ["A", "B", "tie"] as const;
const MARGINS = ["clear", "slight", "none"] as const;

const Verdict = Schema.Struct({
  levels: Schema.Record(Schema.String, Schema.Literals(SIDES)),
  margin: Schema.Literals(MARGINS),
  reasons: Schema.Array(Schema.String),
  winner: Schema.Literals(SIDES),
});

const verdictSchema = {
  additionalProperties: false,
  properties: {
    levels: {
      additionalProperties: false,
      properties: Object.fromEntries(
        LEVELS.map((l) => [l, { enum: SIDES, type: "string" }])
      ),
      required: LEVELS,
      type: "object",
    },
    margin: { enum: MARGINS, type: "string" },
    reasons: { items: { type: "string" }, type: "array" },
    winner: { enum: SIDES, type: "string" },
  },
  required: ["winner", "margin", "levels", "reasons"],
  type: "object",
};

/** A verdict with its letters turned into the rounds' names. */
const Judged = Schema.Struct({
  levels: Schema.Record(Schema.String, Schema.String),
  margin: Schema.String,
  reasons: Schema.Array(Schema.String),
  shownFirst: Schema.String,
  winner: Schema.String,
});
const Results = Schema.Record(Schema.String, Judged);

/** A stable number from a run's name, so the same run always shows the same round first. */
const hash = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7);

const RUN_RE = /^run-\d+$/;
/** A skill file named on a line of the trace that reaches the skills' cache. */
const SKILL_FILE_RE = /((?:patterns|studies)\/)?([a-z-]+)\.md/g;

/** The skill's files a run opened, from the tool calls of its trace. */
const readsOf = Effect.fn("readsOf")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(dir, "trace.md");
  const trace = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : "";
  const files = new Set<string>();
  for (const line of trace.split("\n")) {
    if (line.includes(".cache/ultrapaint/skills")) {
      for (const m of line.matchAll(SKILL_FILE_RE)) {
        files.add(`${m[1] ?? ""}${m[2]}.md`);
      }
    }
  }
  return [...files].sort();
});

const pictures = (dir: string) =>
  Effect.map(listDir(dir), (files) =>
    files
      .filter((f) => f.endsWith(".jpg"))
      .map((f) => `- \`${fromData(path.join(dir, f))}\``)
      .join("\n")
  );

/** The runs both rounds drew, as `<reference>/run-<n>`. */
const sharedRuns = Effect.fn("sharedRuns")(function* (a: string, b: string) {
  const fs = yield* FileSystem.FileSystem;
  const shot = (round: string, key: string) =>
    fs.exists(path.join(RUNS, round, key, "shots"));
  const keys: string[] = [];
  for (const reference of yield* listDir(path.join(RUNS, a))) {
    const dir = path.join(RUNS, a, reference);
    // A round's directory holds its findings and report beside the references' runs.
    if ((yield* fs.stat(dir)).type !== "Directory") {
      continue;
    }
    for (const run of yield* listDir(dir)) {
      const key = `${reference}/${run}`;
      if (RUN_RE.test(run) && (yield* shot(a, key)) && (yield* shot(b, key))) {
        keys.push(key);
      }
    }
  }
  return keys;
});

/** One run of each round judged against the other, the verdict under the rounds' names. */
const judgeRun = Effect.fn("judgeRun")(function* (
  a: string,
  b: string,
  key: string,
  options: { readonly model: string; readonly principles: string }
) {
  const claude = yield* Claude;
  const reference = key.slice(0, key.indexOf("/"));
  // Which round shows as A follows the run's name, so neither is always first.
  const flip = hash(key) % 2 === 1;
  const [first, second] = flip ? [b, a] : [a, b];
  const nameOf = (side: string) => {
    if (side === "tie") {
      return "tie";
    }
    return side === "A" ? first : second;
  };
  const answer = yield* claude.ask({
    cwd: DATA,
    effort: "high",
    model: options.model,
    prompt: yield* prompt("pairwise", {
      a: yield* pictures(path.join(RUNS, first, key, "shots")),
      b: yield* pictures(path.join(RUNS, second, key, "shots")),
      principles: options.principles,
      reference: yield* pictures(captureDir(reference)),
    }),
    schema: verdictSchema,
  });
  const verdict = yield* Schema.decodeUnknownEffect(Verdict)(answer.structured);
  return {
    levels: Object.fromEntries(
      Object.entries(verdict.levels).map(([l, v]) => [l, nameOf(v)])
    ),
    margin: verdict.margin,
    reasons: verdict.reasons,
    shownFirst: first,
    winner: nameOf(verdict.winner),
  };
});

/** How many runs each round won, overall and level by level. */
const tallyOf = (results: Readonly<Record<string, typeof Judged.Type>>) => {
  const tally: Record<string, number> = {};
  const count = (k: string) => {
    tally[k] = (tally[k] ?? 0) + 1;
  };
  for (const r of Object.values(results)) {
    count(r.winner);
    for (const [level, side] of Object.entries(r.levels)) {
      count(`${level}:${side}`);
    }
  }
  return tally;
};

export const pairwise = Effect.fn("pairwise")(function* (
  a: string,
  b: string,
  options: { readonly model: string }
) {
  const fs = yield* FileSystem.FileSystem;
  const out = path.join(RUNS, `${a}-vs-${b}`);
  const file = path.join(out, "pairwise.json");
  const results: Record<string, typeof Judged.Type> = (yield* fs.exists(file))
    ? { ...(yield* readJson(Results, file)) }
    : {};
  const reads: Record<string, Record<string, readonly string[]>> = {};
  const principles = yield* fs.readFileString(
    path.join(PROMPTS, "principles.md")
  );

  for (const key of yield* sharedRuns(a, b)) {
    reads[key] = {
      [a]: yield* readsOf(path.join(RUNS, a, key)),
      [b]: yield* readsOf(path.join(RUNS, b, key)),
    };
    if (results[key]) {
      continue;
    }
    const judged = yield* judgeRun(a, b, key, {
      model: options.model,
      principles,
    }).pipe(
      // A run the judge could not answer for is left out; the next call asks again.
      Effect.catch((error) =>
        Effect.as(
          Effect.logWarning(`${key}: not judged: ${String(error)}`),
          undefined
        )
      )
    );
    if (judged) {
      results[key] = judged;
      yield* writeJson(file, results);
      yield* Effect.log(`${key}: ${judged.winner} (${judged.margin})`);
    }
  }
  yield* writeJson(path.join(out, "reads.json"), reads);
  yield* Effect.log(`tally ${JSON.stringify(tallyOf(results))}`);
});
