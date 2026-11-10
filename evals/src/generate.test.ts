import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Browser } from "./browser.ts";
import { editorReviewOf, type GenerateOptions, generate } from "./generate.ts";
import { Models } from "./models.ts";
import { readData, TestData, writeData } from "./test-data.ts";

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

describe("the editor's review in a round", () => {
  const flags = {
    approval: "all",
    eachRound: "rotate",
    effort: "high",
    goal: { maxRounds: 2 },
    logFindings: false,
    reviewers: ["opus", "cursor:grok-4.7-high"],
  } as const;

  it("has the editor keep its findings log when the round logs findings, and not otherwise", () => {
    assert.strictEqual(
      editorReviewOf({ ...flags, logFindings: true }).findingsLog,
      true
    );
    assert.notProperty(editorReviewOf(flags), "findingsLog");
  });
});

describe("a round's record", () => {
  const Recorded = Schema.fromJsonString(
    Schema.Struct({
      skillTree: Schema.Struct({
        dir: Schema.String,
        files: Schema.Record(Schema.String, Schema.String),
      }),
    })
  );

  it.effect(
    "holds the skill tree the round ran with: where the round keeps it, and every file of the skill with the hash of its text",
    () =>
      Effect.gen(function* () {
        yield* generate([], options);
        const { skillTree } = yield* Schema.decodeUnknownEffect(Recorded)(
          yield* readData("runs/r/round.json")
        );
        assert.strictEqual(skillTree.dir, "skills/shipped");
        const files = Object.keys(skillTree.files);
        assert.includeMembers(files, [
          "SKILL.md",
          "references/kinds/dialog.md",
          "references/states.md",
        ]);
        // The skill's README is beside it in the checkout, and no part of it.
        assert.notInclude(files, "README.md");
        for (const file of ["SKILL.md", "references/kinds/dialog.md"]) {
          assert.strictEqual(
            skillTree.files[file],
            createHash("sha256")
              .update(yield* readData(`runs/r/skills/shipped/${file}`))
              .digest("hex")
          );
        }
      }).pipe(Effect.provide(world))
  );
});
