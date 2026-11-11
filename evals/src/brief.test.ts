import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { writeBrief } from "./brief.ts";
import { type Asked, Models } from "./models.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const reference = (brief?: "copy" | "facts") => ({
  id: "acme",
  kind: "landing",
  name: "Acme: landing page",
  why: "A calm page.",
  ...(brief ? { brief } : {}),
});

const briefed = (brief?: "copy" | "facts") => {
  const asked: Asked[] = [];
  return Effect.gen(function* () {
    yield* writeData({ "references/acme/capture/desktop-fold.jpg": "" });
    yield* writeBrief(reference(brief), { force: false, model: "opus" }).pipe(
      Effect.provide(
        Models.layerTest((question) => {
          asked.push(question);
          return { brief: "# Acme: landing page" };
        })
      )
    );
    return {
      asked,
      written: yield* readData("references/acme/brief.md"),
    };
  });
};

describe("brief", () => {
  it.effect("hands the page's words by default", () =>
    Effect.gen(function* () {
      const { asked, written } = yield* briefed();
      assert.include(asked[0]?.prompt ?? "", "verbatim");
      assert.strictEqual(written, "# Acme: landing page\n");
    }).pipe(Effect.provide(TestData))
  );

  it.effect("hands only the facts to a reference briefed with facts", () =>
    Effect.gen(function* () {
      const { asked } = yield* briefed("facts");
      assert.include(asked[0]?.prompt ?? "", "Hand no words of the page");
      assert.notInclude(asked[0]?.prompt ?? "", "verbatim");
    }).pipe(Effect.provide(TestData))
  );
});
