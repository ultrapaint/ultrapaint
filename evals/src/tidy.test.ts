import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { TestClock } from "effect/testing";
import { EvalsConfig } from "./config.ts";
import { TestData, writeData } from "./test-data.ts";
import { changesOf, changesOnMain, findScratch } from "./tidy.ts";

const NOW = Date.UTC(2026, 10, 23);
const DAY_MS = 24 * 60 * 60 * 1000;

const change = (
  file: string,
  more: { added?: string[]; removed?: string[]; deleted?: boolean } = {}
) => ({
  added: more.added ?? [],
  deleted: more.deleted ?? false,
  file,
  removed: more.removed ?? [],
  unread: false,
});

describe("changesOnMain", () => {
  it("takes a result line carried over with its versions renamed as on main", () => {
    const changes = [
      change("evals/gaps/g01-empty.md", {
        added: [
          "- `up88-told`: 2026-11-22, caught: up88-shipped 3/3, shipped 2/3",
        ],
      }),
    ];
    const main = new Map([
      [
        "evals/gaps/g01-empty.md",
        "**Result.**\n- `up88-told`: 2026-11-22, caught: main 3/3, up88-2 2/3\n",
      ],
    ]);
    assert.isTrue(Option.isNone(changesOnMain(changes, main)));
  });

  it("keeps a checkout whose added line main has only inside another", () => {
    const changes = [change("evals/src/a.ts", { added: ["return true;"] })];
    const main = new Map([
      ["evals/src/a.ts", "// return true; was the old one\n"],
    ]);
    const why = changesOnMain(changes, main);
    assert.isTrue(Option.isSome(why));
    assert.include(Option.getOrThrow(why), "evals/src/a.ts");
  });

  it("keeps a checkout that removes a line main still has", () => {
    const changes = [
      change("evals/prompts/review.md", { removed: ["- a rule"] }),
    ];
    const main = new Map([["evals/prompts/review.md", "- a rule\n"]]);
    assert.isTrue(Option.isSome(changesOnMain(changes, main)));
  });

  it("keeps a checkout that deletes a file main still has, and not one main deleted too", () => {
    const changes = [change("evals/gaps/g98-old.md", { deleted: true })];
    assert.isTrue(
      Option.isSome(
        changesOnMain(changes, new Map([["evals/gaps/g98-old.md", "text"]]))
      )
    );
    assert.isTrue(
      Option.isNone(
        changesOnMain(changes, new Map([["evals/gaps/g98-old.md", undefined]]))
      )
    );
  });

  it("keeps a checkout whose changed file is not on main", () => {
    const changes = [
      change("evals/gaps/g99-new.md", { added: ["- `r1`: caught"] }),
    ];
    const main = new Map([["evals/gaps/g99-new.md", undefined]]);
    assert.isTrue(Option.isSome(changesOnMain(changes, main)));
  });

  it("keeps a checkout with a change that is not one of lines", () => {
    const changes = [{ ...change("docs/a.png"), unread: true }];
    assert.isTrue(Option.isSome(changesOnMain(changes, new Map())));
  });
});

describe("changesOf", () => {
  it("reads a diff's lines file by file, a line inside a hunk never a header", () => {
    const diff = [
      "diff --git a/evals/gaps/g01.md b/evals/gaps/g01.md",
      "--- a/evals/gaps/g01.md",
      "+++ b/evals/gaps/g01.md",
      "@@ -9,0 +10,2 @@",
      "+- `r1`: caught 2/3",
      "+++ counter;",
      "--- gone",
      "diff --git a/evals/gaps/g02.md b/evals/gaps/g02.md",
      "deleted file mode 100644",
      "--- a/evals/gaps/g02.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-text",
      "diff --git a/old.md b/new.md",
      "similarity index 100%",
      "rename from old.md",
      "rename to new.md",
    ].join("\n");
    const changes = changesOf(diff);
    assert.deepStrictEqual(changes[0], {
      added: ["- `r1`: caught 2/3", "++ counter;"],
      deleted: false,
      file: "evals/gaps/g01.md",
      removed: ["-- gone"],
      unread: false,
    });
    assert.strictEqual(changes[1]?.file, "evals/gaps/g02.md");
    assert.isTrue(changes[1]?.deleted);
    assert.isTrue(changes[2]?.unread);
  });

  it("reads a file renamed and edited as a change that is not one of lines", () => {
    const diff = [
      "diff --git a/evals/gaps/old.md b/evals/gaps/new.md",
      "similarity index 90%",
      "rename from evals/gaps/old.md",
      "rename to evals/gaps/new.md",
      "--- a/evals/gaps/old.md",
      "+++ b/evals/gaps/new.md",
      "@@ -3 +2,0 @@",
      "-a line",
    ].join("\n");
    assert.isTrue(changesOf(diff)[0]?.unread);
  });

  it("reads a path git quotes as a change that is not one of lines, deleted or edited", () => {
    const edited = [
      'diff --git "a/odd\\tname.md" "b/odd\\tname.md"',
      '--- "a/odd\\tname.md"',
      '+++ "b/odd\\tname.md"',
      "@@ -1 +0,0 @@",
      "-line",
    ].join("\n");
    const deleted = [
      'diff --git "a/odd\\tname.md" "b/odd\\tname.md"',
      "deleted file mode 100644",
      '--- "a/odd\\tname.md"',
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-line",
    ].join("\n");
    assert.isTrue(changesOf(edited)[0]?.unread);
    assert.isTrue(changesOf(deleted)[0]?.unread);
  });

  it("reads a mode changed with the lines as a change that is not one of lines", () => {
    const diff = [
      "diff --git a/scripts/run.sh b/scripts/run.sh",
      "old mode 100644",
      "new mode 100755",
      "--- a/scripts/run.sh",
      "+++ b/scripts/run.sh",
      "@@ -1 +1 @@",
      "+echo hi",
    ].join("\n");
    assert.isTrue(changesOf(diff)[0]?.unread);
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
