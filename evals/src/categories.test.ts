import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CATEGORIES } from "@ultrapaint/contracts/review";
import { Effect, FileSystem } from "effect";
import { EvalsConfig } from "./config.ts";
import { TestData } from "./test-data.ts";

describe("the review council's categories", () => {
  it.effect("are the design skill's references, each one a file", () =>
    Effect.gen(function* () {
      const { checkout } = yield* EvalsConfig;
      const fs = yield* FileSystem.FileSystem;
      const references = path.join(
        checkout,
        "skills",
        "ultrapaint",
        "references"
      );
      const missing: string[] = [];
      for (const category of CATEGORIES) {
        if (!(yield* fs.exists(path.join(references, `${category}.md`)))) {
          missing.push(category);
        }
      }
      assert.deepStrictEqual(missing, []);
    }).pipe(Effect.provide(TestData))
  );
});
