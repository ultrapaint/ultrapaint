/**
 * `compare`: two rounds side by side, for telling whether a host or a candidate skill made the
 * designs better: their scores level by level and reference by reference, the text they added
 * that should not be there, and, when a person reviewed them in pairs, which one they preferred.
 * Only what both rounds judged is compared.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { LEVELS, readJudgement, roundRuns } from "./judge.ts";
import { RUNS, readJson, writeText } from "./layout.ts";
import { readReview } from "./review.ts";

const scoresOf = Effect.fn("scoresOf")(function* (round: string) {
  const scores = new Map<string, number[]>();
  for (const run of yield* roundRuns(round)) {
    const judgement = yield* readJudgement(run.dir).pipe(Effect.option);
    if (judgement._tag === "None") {
      continue;
    }
    for (const score of judgement.value.scores) {
      for (const key of [score.area, `${score.area}@${run.reference}`]) {
        scores.set(key, [...(scores.get(key) ?? []), score.score]);
      }
    }
    scores.set("runs", [...(scores.get("runs") ?? []), 1]);
    scores.set(`runs@${run.reference}`, [
      ...(scores.get(`runs@${run.reference}`) ?? []),
      1,
    ]);
  }
  return scores;
});

/** Unwanted texts per run, as the round's report counted them. */
const unwantedOf = Effect.fn("unwantedOf")(function* (round: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(RUNS, round, "unwanted-text.json");
  if (!(yield* fs.exists(file))) {
    return;
  }
  return yield* readJson(
    Schema.Array(
      Schema.Struct({
        kind: Schema.optional(Schema.String),
        reference: Schema.String,
      })
    ),
    file
  );
});

const mean = (values: readonly number[] | undefined) =>
  values && values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : undefined;

const delta = (x: number, y: number, digits = 1) => {
  const d = y - x;
  return `${x.toFixed(digits)} → ${y.toFixed(digits)} (${d > 0 ? "+" : ""}${d.toFixed(digits)})`;
};

export const compare = Effect.fn("compare")(function* (
  before: string,
  after: string
) {
  const a = yield* scoresOf(before);
  const b = yield* scoresOf(after);
  const both = (key: string) => a.has(key) && b.has(key);
  const others = [...new Set([...a.keys()].filter((k) => !k.includes("@")))]
    .filter(
      (k) =>
        k !== "runs" &&
        k !== "overall" &&
        !(LEVELS as readonly string[]).includes(k)
    )
    .sort();
  const areas = [...LEVELS, ...others, "overall"].filter((k) => both(k));
  const references = [
    ...new Set(
      [...a.keys()]
        .filter((k) => k.startsWith("overall@"))
        .map((k) => k.slice("overall@".length))
    ),
  ].filter((r) => both(`overall@${r}`));
  const cell = (key: string) => {
    const x = mean(a.get(key));
    const y = mean(b.get(key));
    return x === undefined || y === undefined ? "–" : delta(x, y);
  };

  // Noise only: invented content is a different failing, and a filled table is not clutter.
  const noiseOnly = (
    list:
      | readonly { readonly kind?: string; readonly reference: string }[]
      | undefined
  ) => list?.filter((u) => u.kind === undefined || u.kind === "noise");
  const unwantedA = noiseOnly(yield* unwantedOf(before));
  const unwantedB = noiseOnly(yield* unwantedOf(after));
  const perRun = (
    list: readonly { readonly reference: string }[],
    scores: Map<string, number[]>,
    reference?: string
  ) =>
    list.filter((u) => reference === undefined || u.reference === reference)
      .length /
    Math.max(
      1,
      (scores.get(reference ? `runs@${reference}` : "runs") ?? []).length
    );
  const unwantedCell = (reference?: string) =>
    unwantedA && unwantedB
      ? delta(perRun(unwantedA, a, reference), perRun(unwantedB, b, reference))
      : "–";

  // A pair's verdict is kept with the round named first when the review was started.
  const verdicts = {
    ...(yield* readReview(before)),
    ...(yield* readReview(after)),
  };
  // What a person preferred, side by side: whole designs, layouts, and each kind of section.
  const wins = new Map<string, { a: number; b: number }>();
  for (const v of Object.values(verdicts)) {
    if (!v.sides || v.choice === "skip") {
      continue;
    }
    const winner = v.sides[v.choice === "left" ? 0 : 1];
    const what =
      v.kind === "section"
        ? `section: ${v.subject}`
        : { layout: "layout only", pair: "whole design" }[v.kind as string];
    if (!what || (winner !== before && winner !== after)) {
      continue;
    }
    const count = wins.get(what) ?? { a: 0, b: 0 };
    if (winner === before) {
      count.a += 1;
    } else {
      count.b += 1;
    }
    wins.set(what, count);
  }
  const winsOrdered = [...wins.entries()].sort(
    ([x], [y]) =>
      Number(x.startsWith("section")) - Number(y.startsWith("section")) ||
      x.localeCompare(y)
  );

  const text = [
    `# ${before} → ${after}`,
    "",
    `| Level | All | ${references.join(" | ")} |`,
    `| --- | --- | ${references.map(() => "---").join(" | ")} |`,
    ...areas.map(
      (area) =>
        `| ${area} | ${cell(area)} | ${references.map((r) => cell(`${area}@${r}`)).join(" | ")} |`
    ),
    `| noise texts per run | ${unwantedCell()} | ${references.map((r) => unwantedCell(r)).join(" | ")} |`,
    "",
    ...(wins.size > 0
      ? [
          "## What a person preferred",
          "",
          `Side by side, sides hidden: how often each round's design was the better one.`,
          "",
          `| Compared | ${before} | ${after} |`,
          "| --- | --- | --- |",
          ...winsOrdered.map(([what, c]) => `| ${what} | ${c.a} | ${c.b} |`),
          "",
        ]
      : []),
    "Over a few runs a small difference can be noise: two rounds of the same skills, compared, say how much.",
    "",
  ].join("\n");
  const file = path.join(RUNS, after, `compare-${before}.md`);
  yield* writeText(file, text);
  yield* Effect.log(`\n${text}`);
});
