import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Browser } from "./browser.ts";
import { type GenerateOptions, generate } from "./generate.ts";
import { Models } from "./models.ts";
import { TestData, writeData } from "./test-data.ts";

const options: GenerateOptions = {
  agent: "claude-code",
  host: "blank",
  minutes: 1,
  model: undefined,
  picture: false,
  round: "r",
  runs: 1,
};

/** A round started before, with the review its record names, if any. */
const started = (review?: string) =>
  writeData({
    "runs/r/round.json": {
      agent: "claude-code",
      commit: "abc",
      host: "blank",
      name: "r",
      references: [],
      ...(review !== undefined && { review: { mode: review, reviewers: [] } }),
      runs: 1,
      skills: "built-in",
      startedAt: "2026-11-04T00:00:00.000Z",
    },
  });

// No reference: the round's record is checked, and nothing is left to generate.
const world = Layer.mergeAll(
  TestData,
  Browser.layerTest,
  Models.layerTest(() => ({}))
);

describe("a round run again", () => {
  it.effect("goes on with the editor's review it was started with", () =>
    Effect.gen(function* () {
      yield* started("editor");
      yield* generate([], { ...options, editorReview: { on: true } });
    }).pipe(Effect.provide(world))
  );

  it.effect("is refused the editor's review when started with none", () =>
    Effect.gen(function* () {
      yield* started();
      const refused = yield* Effect.flip(
        generate([], { ...options, editorReview: { on: true } })
      );
      assert.include(
        refused.message,
        "round r was started with review none; name a new round to review editor"
      );
    }).pipe(Effect.provide(world))
  );
});
