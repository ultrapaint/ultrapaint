import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { TestClock } from "effect/testing";
import { EvalsConfig } from "./config.ts";
import { TestData, writeData } from "./test-data.ts";
import { addedLines, changesOnMain, findScratch } from "./tidy.ts";

const NOW = Date.UTC(2026, 10, 23);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("changesOnMain", () => {
  it("takes a result line carried over with its versions renamed as on main", () => {
    const added = new Map([
      [
        "evals/gaps/g01-empty.md",
        ["- `up88-told`: 2026-11-22, caught: up88-shipped 3/3, shipped 2/3"],
      ],
    ]);
    const main = new Map([
      [
        "evals/gaps/g01-empty.md",
        "**Result.**\n- `up88-told`: 2026-11-22, caught: main 3/3, up88-2 2/3\n",
      ],
    ]);
    assert.isTrue(Option.isNone(changesOnMain(added, main)));
  });

  it("keeps a checkout with a line main does not have, and says which", () => {
    const added = new Map([["evals/prompts/review.md", ["- a new rule", ""]]]);
    const main = new Map([["evals/prompts/review.md", "- an old rule\n"]]);
    const why = changesOnMain(added, main);
    assert.isTrue(Option.isSome(why));
    assert.include(Option.getOrThrow(why), "evals/prompts/review.md");
  });

  it("keeps a checkout whose changed file is not on main", () => {
    const added = new Map([["evals/gaps/g99-new.md", ["- `r1`: caught"]]]);
    const main = new Map([["evals/gaps/g99-new.md", undefined]]);
    assert.isTrue(Option.isSome(changesOnMain(added, main)));
  });
});

describe("addedLines", () => {
  it("reads the lines a diff adds, by file", () => {
    const diff = [
      "diff --git a/evals/gaps/g01.md b/evals/gaps/g01.md",
      "--- a/evals/gaps/g01.md",
      "+++ b/evals/gaps/g01.md",
      "@@ -9,0 +10,2 @@",
      "+- `r1`: caught 2/3",
      "+- `r2`: caught 3/3",
      "-- gone",
    ].join("\n");
    assert.deepStrictEqual(
      [...addedLines(diff)],
      [["evals/gaps/g01.md", ["- `r1`: caught 2/3", "- `r2`: caught 3/3"]]]
    );
  });
});

describe("findScratch", () => {
  it.effect(
    "finds finished outside runs' own installs and old logs, and leaves the rest",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const { data } = yield* EvalsConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* writeData({
          ".work/new.log": "",
          ".work/old-notes.json": "{}",
          ".work/old.log": "",
          ".work/old.pgid": "1",
          ".work/outside/fx/ref/run-1/node_modules/pkg/index.js": "",
          ".work/outside/fx/ref/run-2/package.json": "{}",
          ".work/outside/fx/ref/run-3/node_modules/pkg/index.js": "",
          "hosts/blank/app/node_modules/vite/index.js": "",
          "runs/fx/ref/run-1/run.json": {},
          "runs/fx/ref/run-2/run.json": {},
        });
        // run-2 kept the host's link; run-3 has not finished.
        yield* fs.symlink(
          path.join(data.hosts, "blank", "app", "node_modules"),
          path.join(data.work, "outside", "fx", "ref", "run-2", "node_modules")
        );
        const old = new Date(NOW - 31 * DAY_MS);
        for (const file of ["old.log", "old.pgid", "old-notes.json"]) {
          yield* fs.utimes(path.join(data.work, file), old, old);
        }
        yield* fs.utimes(
          path.join(data.work, "new.log"),
          new Date(NOW - DAY_MS),
          new Date(NOW - DAY_MS)
        );

        const found = yield* findScratch();
        assert.deepStrictEqual(found.installs.map(data.fromData), [
          ".work/outside/fx/ref/run-1/node_modules",
        ]);
        assert.deepStrictEqual([...found.logs].map(data.fromData).sort(), [
          ".work/old.log",
          ".work/old.pgid",
        ]);
        assert.deepStrictEqual(found.checkouts, []);
      }).pipe(Effect.provide(TestData))
  );
});
