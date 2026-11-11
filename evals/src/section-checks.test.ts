import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { EvalsConfig } from "./config.ts";
import {
  checkFacts,
  type Measurement,
  readSectionChecks,
  recordSectionChecks,
} from "./section-checks.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const measured = (
  theme: "dark" | "light",
  more: Partial<Measurement> = {}
): Measurement => ({
  checks: [
    {
      check: "touching-rows",
      detail: "rows of 28px, rounded or filled, with no gap between them",
      label: "Design files",
      on: "rest",
    },
  ],
  dividers: [],
  grid: 4,
  ratio: 3,
  root: "body",
  spacing: [
    {
      above: "App components",
      below: "System components",
      between: 27,
      within: 10,
    },
  ],
  theme,
  ...more,
});

describe("section checks", () => {
  it("lists each finding once, naming a theme only when the other theme lacks it", () => {
    const facts = checkFacts({
      commit: "abc1234",
      measured: [
        measured("dark"),
        measured("light", {
          dividers: [{ bar: "Tools", off: -6 }],
        }),
      ],
    });
    assert.include(
      facts,
      "- groups: 27px between “App components” and “System components”, 10px between the lines below: under 3×\n"
    );
    assert.include(
      facts,
      "- divider: -6px off its bar's line, in “Tools” (light only)"
    );
    assert.include(facts, "every gap and padding on a 4px scale");
    assert.include(facts, "3 in all");
  });

  it("names one finding once with every element it was found on, a gap set on both axes as one gap", () => {
    const offScale = (axis: string, label: string) => ({
      check: "off-scale",
      detail: `${axis} 2px, not on the 4px scale`,
      label,
      on: "rest" as const,
    });
    const facts = checkFacts({
      commit: "abc1234",
      measured: [
        measured("dark", {
          checks: [
            offScale("rowGap", "Layers"),
            offScale("columnGap", "Layers"),
            offScale("columnGap", "Toolbar"),
          ],
          spacing: [],
        }),
      ],
    });
    assert.include(
      facts,
      "- off-scale: gap 2px, not on the 4px scale: “Layers”\n"
    );
    assert.include(
      facts,
      "- off-scale: columnGap 2px, not on the 4px scale: “Toolbar”"
    );
    assert.notInclude(facts, "rowGap");
  });

  it("says when the checks could not run, and when they found nothing", () => {
    assert.strictEqual(
      checkFacts({
        commit: "abc1234",
        measured: [],
        notRun: "no editor at that commit",
      }),
      "The checks could not run on this section: no editor at that commit."
    );
    assert.include(
      checkFacts({
        commit: "abc1234",
        measured: [measured("dark", { checks: [], spacing: [] })],
      }),
      "found nothing"
    );
  });

  it.effect(
    "keeps one measurement per theme at the section's commit, the latest",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          "gaps/sections/panel/section.json": { commit: "abc1234" },
        });
        yield* recordSectionChecks("panel", measured("light"));
        yield* recordSectionChecks("panel", measured("dark"));
        yield* recordSectionChecks(
          "panel",
          measured("light", { checks: [], spacing: [] })
        );
        const checks = yield* readSectionChecks("panel");
        assert.strictEqual(checks.commit, "abc1234");
        assert.deepStrictEqual(
          checks.measured.map((m) => [m.theme, m.spacing.length]),
          [
            ["dark", 1],
            ["light", 0],
          ]
        );
        assert.include(
          yield* readData("gaps/sections/panel/checks.json"),
          '"commit": "abc1234"'
        );
      }).pipe(Effect.provide(TestData))
  );

  it.effect(
    "keeps the picture of the root taken with a theme's measurement beside it, and names it",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          "gaps/sections/panel/section.json": { commit: "abc1234" },
        });
        const box = { height: 20, width: 80, x: 12, y: 40 };
        yield* recordSectionChecks(
          "panel",
          measured("dark", {
            checks: [
              {
                box,
                check: "target-size",
                detail: "16×16, under 24×24",
                label: "Collapse",
                on: "rest",
              },
            ],
            rootBox: { height: 900, width: 300, x: 8, y: 48 },
          }),
          new Uint8Array([137, 80, 78, 71])
        );
        const [dark] = (yield* readSectionChecks("panel")).measured;
        assert.strictEqual(dark?.shot, "checks-dark@2x.png");
        assert.deepStrictEqual(dark?.checks[0]?.box, box);
        assert.deepStrictEqual(dark?.rootBox?.width, 300);
        const fs = yield* FileSystem.FileSystem;
        const { data } = yield* EvalsConfig;
        assert.isTrue(
          yield* fs.exists(`${data.sections}/panel/checks-dark@2x.png`)
        );
      }).pipe(Effect.provide(TestData))
  );

  it.effect("fails on a section whose checks were never measured", () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(readSectionChecks("panel"));
      assert.include(failed.message, "measure <url> --section panel");
    }).pipe(Effect.provide(TestData))
  );
});
