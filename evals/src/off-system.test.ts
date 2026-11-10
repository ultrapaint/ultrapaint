import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { offSystem } from "./off-system.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const RUN = "runs/r/home/run-1";

/** A page whose one row sets its own gap, the row of a type given. */
const pageWith = (type: string) => ({
  root: {
    children: [{ children: [], gap: 10, id: "list", name: "List", type }],
    id: "root",
    type: "page",
  },
  version: 1,
});

describe("off-system", () => {
  it.effect(
    "counts the values off the system in the pages that are pages, and leaves out a page that is not one",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          [`${RUN}/pages/home.page.json`]: pageWith("row"),
          // Another commit's page: a node no contract of this one has.
          [`${RUN}/pages/older.page.json`]: pageWith("frame"),
          [`${RUN}/run.json`]: {},
        });
        yield* offSystem(["r"]);

        const table = yield* readData("runs/r/off-system.md");
        assert.include(table, "| home/run-1 | **1** | 1 | 0 |");
        assert.include(table, "- home.page.json › List: `gap` 10 (spacing)");
        assert.notInclude(table, "older.page.json");
      }).pipe(Effect.provide(TestData))
  );
});
