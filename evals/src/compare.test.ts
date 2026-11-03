import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { compare } from "./compare.ts";
import { judgement, readData, TestData, writeData } from "./test-data.ts";

/** A judged run of a round, with its scores. */
const judged = (
  round: string,
  reference: string,
  run: number,
  scores: Readonly<Record<string, number>>
) => ({
  [`runs/${round}/${reference}/run-${run}/run.json`]: {},
  [`runs/${round}/${reference}/run-${run}/judge.json`]: judgement(scores),
});

/** The rows of the table `compare` writes, by their first cell. */
const compared = Effect.gen(function* () {
  yield* compare("before", "after");
  const text = yield* readData("runs/after/compare-before.md");
  return new Map(
    text
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .map((line) => [line.split(" | ")[0]?.slice(2), line] as const)
  );
});

describe("compare", () => {
  it.effect(
    "a level is the mean of each round's runs and its change, over every run and per reference both judged",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          ...judged("before", "home", 1, { layout: 3, overall: 3 }),
          ...judged("before", "home", 2, { layout: 4, overall: 4 }),
          ...judged("before", "pricing", 1, { layout: 2, overall: 2 }),
          ...judged("after", "home", 1, { layout: 5, overall: 5 }),
        });
        const rows = yield* compared;
        assert.strictEqual(rows.get("Level"), "| Level | All | home |");
        assert.strictEqual(
          rows.get("layout"),
          "| layout | 3.0 → 5.0 (+2.0) | 3.5 → 5.0 (+1.5) |"
        );
        assert.strictEqual(
          rows.get("overall"),
          "| overall | 3.0 → 5.0 (+2.0) | 3.5 → 5.0 (+1.5) |"
        );
      }).pipe(Effect.provide(TestData))
  );

  it.effect(
    "the levels come in their order, an older round's skill after them, overall last, and one only a round scored is left out",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          ...judged("before", "home", 1, {
            color: 4,
            "layout-skill": 2,
            overall: 3,
            typography: 3,
          }),
          ...judged("after", "home", 1, {
            color: 4,
            craft: 5,
            "layout-skill": 3,
            overall: 3,
            typography: 3,
          }),
        });
        const rows = yield* compared;
        assert.deepStrictEqual(
          [...rows.keys()].filter((k) => k !== "Level" && k !== "---"),
          [
            "typography",
            "color",
            "layout-skill",
            "overall",
            "noise texts per run",
          ]
        );
      }).pipe(Effect.provide(TestData))
  );

  it.effect(
    "noise texts are counted per run, an unmarked text as noise and invented content not",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          ...judged("before", "home", 1, { overall: 3 }),
          ...judged("before", "home", 2, { overall: 3 }),
          ...judged("before", "pricing", 1, { overall: 3 }),
          ...judged("after", "home", 1, { overall: 3 }),
          "runs/after/unwanted-text.json": [
            { kind: "noise", reference: "home" },
          ],
          "runs/before/unwanted-text.json": [
            { kind: "noise", reference: "home" },
            { kind: "invented", reference: "home" },
            { reference: "pricing" },
          ],
        });
        const rows = yield* compared;
        assert.strictEqual(
          rows.get("noise texts per run"),
          "| noise texts per run | 0.7 → 1.0 (+0.3) | 0.5 → 1.0 (+0.5) |"
        );
      }).pipe(Effect.provide(TestData))
  );

  it.effect("without a round's count of noise, its cell is empty", () =>
    Effect.gen(function* () {
      yield* writeData({
        ...judged("before", "home", 1, { overall: 3 }),
        ...judged("after", "home", 1, { overall: 3 }),
        "runs/after/unwanted-text.json": [],
      });
      const rows = yield* compared;
      assert.strictEqual(
        rows.get("noise texts per run"),
        "| noise texts per run | – | – |"
      );
    }).pipe(Effect.provide(TestData))
  );

  it.effect(
    "what a person preferred side by side counts for the round on the side they chose",
    () =>
      Effect.gen(function* () {
        const verdict = {
          at: "2026-11-03T10:00:00.000Z",
          reference: "home",
          run: "run-1",
          sides: ["before", "after"],
          subject: "",
        };
        yield* writeData({
          ...judged("before", "home", 1, { overall: 3 }),
          ...judged("after", "home", 1, { overall: 3 }),
          "runs/before/review.json": {
            "layout/1": { ...verdict, choice: "right", kind: "layout" },
            "pair/1": { ...verdict, choice: "left", kind: "pair" },
            "pair/2": { ...verdict, choice: "skip", kind: "pair" },
            "section/1": {
              ...verdict,
              choice: "right",
              kind: "section",
              subject: "Hero",
            },
            "section/2": {
              ...verdict,
              choice: "left",
              kind: "section",
              sides: ["after", "an-older-round"],
              subject: "Hero",
            },
          },
        });
        const rows = yield* compared;
        assert.strictEqual(
          rows.get("Compared"),
          "| Compared | before | after |"
        );
        assert.strictEqual(rows.get("layout only"), "| layout only | 0 | 1 |");
        assert.strictEqual(
          rows.get("whole design"),
          "| whole design | 1 | 0 |"
        );
        assert.strictEqual(
          rows.get("section: Hero"),
          "| section: Hero | 0 | 2 |"
        );
      }).pipe(Effect.provide(TestData))
  );
});
