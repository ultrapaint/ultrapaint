/**
 * `compare`: two rounds' scores side by side, area by area and reference by reference, for
 * telling whether a candidate skill helped. Only what both rounds judged is compared.
 */
import path from "node:path";
import { Effect } from "effect";
import { readJudgement, roundRuns, roundSkills } from "./judge.ts";
import { RUNS, writeText } from "./layout.ts";

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
  }
  return scores;
});

const mean = (values: readonly number[] | undefined) =>
  values && values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : undefined;

export const compare = Effect.fn("compare")(function* (
  before: string,
  after: string
) {
  const a = yield* scoresOf(before);
  const b = yield* scoresOf(after);
  const areas = [...(yield* roundSkills(after)), "overall"];
  const references = [
    ...new Set(
      [...a.keys(), ...b.keys()]
        .filter((k) => k.includes("@"))
        .map((k) => k.split("@")[1] ?? "")
    ),
  ].filter((r) => a.has(`overall@${r}`) && b.has(`overall@${r}`));
  const cell = (key: string) => {
    const x = mean(a.get(key));
    const y = mean(b.get(key));
    if (x === undefined || y === undefined) {
      return "–";
    }
    const delta = y - x;
    const sign = delta > 0 ? "+" : "";
    return `${x.toFixed(1)} → ${y.toFixed(1)} (${sign}${delta.toFixed(1)})`;
  };
  const text = [
    `# ${before} → ${after}`,
    "",
    `| Area | All | ${references.join(" | ")} |`,
    `| --- | --- | ${references.map(() => "---").join(" | ")} |`,
    ...areas.map(
      (area) =>
        `| ${area} | ${cell(area)} | ${references.map((r) => cell(`${area}@${r}`)).join(" | ")} |`
    ),
    "",
    "Over a few runs a small difference can be noise: two rounds of the same skills, compared, say how much.",
    "",
  ].join("\n");
  const file = path.join(RUNS, after, `compare-${before}.md`);
  yield* writeText(file, text);
  yield* Effect.log(`\n${text}`);
});
