import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CATEGORIES, CATEGORY_FILES } from "@ultrapaint/contracts/review";
import { Effect, FileSystem } from "effect";
import { EvalsConfig } from "./config.ts";
import { TestData } from "./test-data.ts";

describe("the review council's categories", () => {
  it.effect("are each held by a file of the design skill", () =>
    Effect.gen(function* () {
      const { checkout } = yield* EvalsConfig;
      const fs = yield* FileSystem.FileSystem;
      const skill = path.join(checkout, "skills", "ultrapaint");
      const missing: string[] = [];
      for (const category of CATEGORIES) {
        const file = path.join(skill, CATEGORY_FILES[category]);
        if (!(yield* fs.exists(file))) {
          missing.push(`${category}: ${CATEGORY_FILES[category]}`);
        }
      }
      assert.deepStrictEqual(missing, []);
    }).pipe(Effect.provide(TestData))
  );
});
