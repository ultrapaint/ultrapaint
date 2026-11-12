import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Asked } from "./models.ts";
import { Models } from "./models.ts";
import { readData, TestData, writeData } from "./test-data.ts";
import { meanAlike, variety } from "./variety.ts";

describe("variety", () => {
  it.effect(
    "rates each brief with two runs or more once, and leaves a brief with one run out",
    () =>
      Effect.gen(function* () {
        const asked: string[] = [];
        const rater = (question: Asked) => {
          asked.push(question.prompt);
          return { alike: 4, shared: ["a split hero"] };
        };
        yield* Effect.gen(function* () {
          yield* writeData({
            "runs/r/hotel/run-1/shots/desktop-fold.jpg": "jpg",
            "runs/r/shop/run-1/shots/desktop-fold.jpg": "jpg",
            "runs/r/shop/run-2/shots/desktop-fold.jpg": "jpg",
          });
          yield* variety("r", { model: "opus" });
          yield* variety("r", { model: "opus" });
          const results = JSON.parse(yield* readData("runs/r/variety.json"));
          assert.deepStrictEqual(Object.keys(results), ["shop"]);
        }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(rater))));
        assert.strictEqual(asked.length, 1);
        assert.include(asked[0], "runs/r/shop/run-2/shots/desktop-fold.jpg");
      })
  );

  it("averages a round's ratings to one decimal, and has none for no brief", () => {
    assert.strictEqual(
      meanAlike({
        a: { alike: 2, shared: [] },
        b: { alike: 3, shared: [] },
        c: { alike: 3, shared: [] },
      }),
      2.7
    );
    assert.strictEqual(meanAlike({}), undefined);
  });
});
