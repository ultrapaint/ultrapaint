import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { EvalsConfig } from "./config.ts";
import { writeText } from "./layout.ts";
import type { Asked } from "./models.ts";
import { Models } from "./models.ts";
import { placeOf, recall, unmatchedOf, withoutTools } from "./recall.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const gapFile = (id: string, kind: string, sections: string) => `---
id: ${id}
title: Gap ${id}
kind: ${kind}
status: open
found: 2026-11-03
source: a test
skill: [references/states.md]
sections: [${sections}]
---

**What happened.** The empty group was the heaviest block of the panel.

**Result.**
`;

const section = (name: string) => ({
  code: ["code/DESIGN.md"],
  commit: "abc1234",
  name,
  pictures: [{ file: "pictures/panel-dark@2x.png", shows: "the panel, dark" }],
  where: "A panel of the editor.",
});

const finding = (title: string) => ({
  fix: "fix it",
  problem: `${title} is wrong.`,
  title,
  where: "the panel",
});

/**
 * Reviewers with the candidate find the empty group, both find a stray hairline; the judge matches
 * the empty group, the grouping puts every leftover together.
 */
const scripted = (asked: Asked) => {
  if (asked.prompt.startsWith("You review")) {
    const candidate = asked.prompt.includes("/skills/fix");
    return {
      findings: [
        ...(candidate ? [finding("Empty group too heavy")] : []),
        finding("A stray hairline"),
      ],
      read: ["SKILL.md"],
    };
  }
  if (asked.prompt.startsWith("A reviewer")) {
    const lines = asked.prompt.split("\n");
    const n = lines.findIndex((l) => l.includes("Empty group too heavy"));
    const number = n < 0 ? undefined : Number(lines[n]?.split(".")[0]);
    return {
      gaps: [
        {
          findings: number === undefined ? [] : [number],
          id: "g01",
          verdict: number === undefined ? "missed" : "caught",
          why: "",
        },
      ],
    };
  }
  const labels = [...asked.prompt.matchAll(LABEL_RE)].map((m) => m[1]);
  return {
    problems: [
      {
        findings: labels,
        problem: "A hairline under the title.",
        title: "Stray hairline",
      },
    ],
  };
};

const LABEL_RE = /^(F\d+)\./gm;
const RESULT_RE =
  /- `r`: \d{4}-\d\d-\d\d, caught: shipped 0\/2, fix 2\/2 \(opus, effort high/;

const world = Layer.merge(TestData, Models.layerTest(scripted));

describe("recall", () => {
  it("lays a candidate over the shipped skill: SKILL.md is the router, the rest references", () => {
    assert.strictEqual(placeOf("SKILL.md"), "SKILL.md");
    assert.strictEqual(placeOf("states.md"), "references/states.md");
    assert.strictEqual(
      placeOf("patterns/canvas-tools.md"),
      "references/patterns/canvas-tools.md"
    );
    assert.strictEqual(
      withoutTools(
        "Ask [with the editor's tools: `get_component` | without: the list] for it."
      ),
      "Ask the list for it."
    );
  });

  it("leaves a finding unmatched unless a gap was caught or partly caught with it", () => {
    const review = {
      findings: [finding("a"), finding("b"), finding("c")],
      read: [],
    };
    assert.deepStrictEqual(
      unmatchedOf(review, {
        gaps: [
          { findings: [1], id: "g01", verdict: "caught", why: "" },
          { findings: [2], id: "g02", verdict: "missed", why: "" },
        ],
      }),
      [2, 3]
    );
    assert.deepStrictEqual(unmatchedOf(review, undefined), [1, 2, 3]);
  });

  it.effect(
    "counts per version the runs that caught each gap, lists what no gap matched, and writes the result into the gaps",
    () =>
      Effect.gen(function* () {
        const { gaps } = yield* EvalsConfig;
        yield* writeText(
          `${gaps}/g01-empty.md`,
          gapFile("g01", "missing", "panel")
        );
        yield* writeText(
          `${gaps}/p01-squint.md`,
          gapFile("p01", "process", "panel")
        );
        yield* writeText(
          `${gaps}/g02-elsewhere.md`,
          gapFile("g02", "missing", "elsewhere")
        );
        yield* writeData({
          "candidates/fix/SKILL.md": "# The candidate's router\n",
          "candidates/fix/states.md": "# The candidate's states\n",
          "gaps/sections/held/code/DESIGN.md": "# Design\n",
          "gaps/sections/held/section.json": section("Held"),
          "gaps/sections/panel/code/DESIGN.md": "# Design\n",
          "gaps/sections/panel/pictures/panel-dark@2x.png": "png",
          "gaps/sections/panel/section.json": section("Panel"),
        });
        yield* recall({
          concurrency: 2,
          effort: "high",
          model: "opus",
          round: "r",
          runs: 2,
          sections: [],
          skills: ["built-in", "candidates/fix"],
        });

        const report = yield* readData("runs/r/report.md");
        assert.include(report, "| g01 Gap g01 | missing | panel | 0/2 | 2/2 |");
        assert.include(report, "| p01 Gap p01 | panel | 0/2 | 2/2 |");
        assert.include(report, "### Held (`held`, held out)");
        // A gap whose section the round didn't review is left out of the report.
        assert.notInclude(report, "g02");
        assert.include(
          report,
          "| **Stray hairline.** A hairline under the title. | 2/2 | 2/2 |  |"
        );
        assert.strictEqual(
          yield* readData("runs/r/skills/fix/SKILL.md"),
          "# The candidate's router\n"
        );
        assert.strictEqual(
          yield* readData("runs/r/skills/fix/references/states.md"),
          "# The candidate's states\n"
        );
        // A reviewer works beside the section's pictures and code, with nothing that names a gap.
        assert.strictEqual(
          yield* readData("runs/r/sections/panel/code/DESIGN.md"),
          "# Design\n"
        );

        const fs = yield* FileSystem.FileSystem;
        const gapText = yield* fs.readFileString(`${gaps}/g01-empty.md`);
        assert.include(gapText, "status: testing");
        assert.match(gapText, RESULT_RE);
        const processText = yield* fs.readFileString(`${gaps}/p01-squint.md`);
        assert.include(
          processText,
          "its sections' gaps caught: shipped 0/2, fix 2/2"
        );
      }).pipe(Effect.provide(world))
  );
});
