import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { type Asked, Models } from "./models.ts";
import { ratingId } from "./recall.ts";
import { readData, TestData, writeData } from "./test-data.ts";
import {
  countFates,
  reviewerOf,
  skepticFor,
  treeOf,
  verify,
} from "./verify.ts";

const finding = (title: string) => ({
  fix: "Fix it.",
  problem: `${title} is wrong.`,
  title,
  where: "the panel",
});

describe("the skeptic", () => {
  it("is never the model that wrote the review", () => {
    const models = ["opus", "gpt-6.1-sol"];
    assert.strictEqual(
      reviewerOf("review-table@gpt-6.1-sol+told", models),
      "gpt-6.1-sol"
    );
    assert.strictEqual(
      reviewerOf("shipped@cursor:grok-4.7-high", models),
      "cursor:grok-4.7-high"
    );
    assert.strictEqual(reviewerOf("shipped+outline", ["opus"]), "opus");
    assert.strictEqual(treeOf("review-table@opus+told"), "review-table");
    assert.strictEqual(
      skepticFor("opus", ["opus", "gpt-6.1-sol"]),
      "gpt-6.1-sol"
    );
    assert.strictEqual(
      skepticFor("gpt-6.1-sol", ["opus", "gpt-6.1-sol"]),
      "opus"
    );
    assert.isUndefined(skepticFor("opus", ["opus"]));
  });

  it("counts what it kept of the gaps' findings, of the real ones and of the noise", () => {
    assert.deepStrictEqual(
      countFates([
        { gap: true, rating: undefined, verdict: "confirmed" },
        { gap: true, rating: undefined, verdict: "refuted" },
        { gap: false, rating: "noise", verdict: "refuted" },
        { gap: false, rating: "real", verdict: "confirmed" },
        { gap: false, rating: undefined, verdict: undefined },
      ]),
      {
        confirmed: 2,
        findings: 4,
        gapKept: 1,
        gapMatched: 2,
        noise: 1,
        noiseRefuted: 1,
        real: 1,
        realKept: 1,
      }
    );
  });

  it.effect(
    "asks the other model of a round's reviews, keeps its verdicts, and reads them against the gaps and the ratings",
    () => {
      const asked: Asked[] = [];
      // Keeps the gap's finding and refutes the hairline.
      const skeptic = (question: Asked) => {
        asked.push(question);
        return {
          verdicts: [
            {
              evidence: "The group is the heaviest block.",
              n: 1,
              severity: "major",
              verdict: "confirmed",
            },
            {
              evidence: "No hairline in the picture.",
              n: 2,
              severity: "nit",
              verdict: "refuted",
            },
          ],
        };
      };
      const dir = "runs/r/panel/table@opus+told/run-1";
      return Effect.gen(function* () {
        yield* writeData({
          [`${dir}/judgement.json`]: {
            costUsd: 0,
            value: {
              gaps: [{ findings: [1], id: "g01", verdict: "caught", why: "" }],
            },
          },
          [`${dir}/review.json`]: {
            costUsd: 0,
            value: {
              findings: [
                finding("Empty group too heavy"),
                finding("A stray hairline"),
              ],
              read: [],
            },
          },
          "decisions/rate-r.answers.json": {
            [ratingId("panel", "Stray hairline")]: {
              at: "2026-11-11T00:00:00.000Z",
              choice: "noise",
              label: "Noise",
              title: "Stray hairline",
            },
          },
          "gaps/sections/panel/section.json": {
            code: ["code/DESIGN.md"],
            commit: "abc1234",
            name: "Panel",
            pictures: [{ file: "pictures/panel@2x.png", shows: "the panel" }],
            where: "A panel of the editor.",
          },
          "runs/r/panel/unmatched.json": {
            costUsd: 0,
            value: {
              keys: ["table@opus+told/run-1#2"],
              problems: [
                {
                  findings: ["table@opus+told/run-1#2"],
                  problem: "A hairline.",
                  title: "Stray hairline",
                },
              ],
            },
          },
          "runs/r/recall.json": { models: ["opus", "gpt-6.1-sol"] },
          "runs/r/skills/table/references/review.md":
            "| You see | Fix |\n| --- | --- |\n| A double edge | One edge |\n",
          "runs/r/skills/table/SKILL.md":
            "# Skill\n\n## The rules\n\n- One edge, drawn once.\n",
        });
        const options = {
          concurrency: 1,
          effort: "high",
          round: "r",
          skeptics: ["opus", "gpt-6.1-sol"],
        };
        yield* verify(options);

        assert.deepStrictEqual(
          asked.map((a) => a.model),
          ["gpt-6.1-sol"]
        );
        assert.include(asked[0]?.prompt ?? "", "- One edge, drawn once.");
        assert.include(asked[0]?.prompt ?? "", "| A double edge | One edge |");
        assert.include(asked[0]?.prompt ?? "", "2. **A stray hairline**");
        assert.include(
          yield* readData("runs/r/verify.md"),
          "| table@opus+told | 2 | 1/2 · 50% | 1/1 · 100% | – | 1/1 · 100% |"
        );
        // Run again, it asks nobody twice.
        yield* verify(options);
        assert.strictEqual(asked.length, 1);
      }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(skeptic))));
    }
  );
});
