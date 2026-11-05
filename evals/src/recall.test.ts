import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { EvalsConfig } from "./config.ts";
import { writeText } from "./layout.ts";
import type { Asked } from "./models.ts";
import { Models } from "./models.ts";
import {
  placeOf,
  recall,
  spentLines,
  unmatchedOf,
  versionsOf,
  withoutTools,
} from "./recall.ts";
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
          judgeModel: "opus",
          models: ["opus"],
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

  it("names a version by its skill alone with one reviewing model, and by its skill and model with several", () => {
    assert.deepStrictEqual(
      versionsOf(["built-in"], ["opus"]).map((v) => v.name),
      ["shipped"]
    );
    assert.deepStrictEqual(
      versionsOf(["built-in", "candidates/fix"], ["opus", "gpt-6.1-sol"]).map(
        (v) => v.name
      ),
      ["shipped@opus", "shipped@gpt-6.1-sol", "fix@opus", "fix@gpt-6.1-sol"]
    );
  });

  it("reports what a version's reviews took on average, and – where nothing was kept", () => {
    const review = (findings: number) => ({
      findings: Array.from({ length: findings }, (_, i) => ({
        fix: "f",
        problem: "p",
        title: `t${i}`,
        where: "w",
      })),
      read: [],
    });
    const lines = spentLines(
      {
        a: [
          {
            judgement: undefined,
            review: review(4),
            run: 1,
            spent: { seconds: 100, tokens: 2000 },
            version: "shipped",
          },
          {
            judgement: undefined,
            review: review(2),
            run: 2,
            spent: { seconds: 60, tokens: 1000 },
            version: "shipped",
          },
          {
            judgement: undefined,
            review: review(1),
            run: 1,
            version: "shipped+outline",
          },
        ],
      },
      ["shipped", "shipped+outline"]
    );
    assert.include(lines, "| shipped | 2 | 3 | 80 | 1500 |");
    assert.include(lines, "| shipped+outline | 1 | 1 | – | – |");
  });

  it("names a reviewer shown the outline with `+outline` after its version", () => {
    assert.deepStrictEqual(
      versionsOf(["built-in"], ["gpt-6.1-sol"], ["pictures", "outline"]).map(
        (v) => [v.name, v.input]
      ),
      [
        ["shipped", "pictures"],
        ["shipped+outline", "outline"],
      ]
    );
  });

  it.effect(
    "compares the models that review, with every review judged by one model",
    () => {
      const judgedBy = new Set<string>();
      // GPT finds the empty group, Opus doesn't; whoever reviewed, the judge is asked the same.
      const byModel = (asked: Asked) => {
        if (asked.prompt.startsWith("You review")) {
          return {
            findings: [
              ...(asked.model === "gpt-6.1-sol"
                ? [finding("Empty group too heavy")]
                : []),
              finding("A stray hairline"),
            ],
            read: ["SKILL.md"],
          };
        }
        judgedBy.add(asked.model);
        return scripted(asked);
      };
      return Effect.gen(function* () {
        const { gaps } = yield* EvalsConfig;
        yield* writeText(
          `${gaps}/g01-empty.md`,
          gapFile("g01", "missing", "panel")
        );
        yield* writeData({
          "gaps/sections/panel/code/DESIGN.md": "# Design\n",
          "gaps/sections/panel/pictures/panel-dark@2x.png": "png",
          "gaps/sections/panel/section.json": section("Panel"),
        });
        yield* recall({
          concurrency: 2,
          effort: "high",
          judgeModel: "opus",
          models: ["opus", "gpt-6.1-sol"],
          round: "m",
          runs: 1,
          sections: [],
          skills: ["built-in"],
        });
        const report = yield* readData("runs/m/report.md");
        assert.include(
          report,
          "| Gap | Kind | Section | shipped@opus | shipped@gpt-6.1-sol |"
        );
        assert.include(report, "| g01 Gap g01 | missing | panel | 0/1 | 1/1 |");
        assert.include(
          report,
          "Reviewers: `opus`, `gpt-6.1-sol`; every judge and grouping: `opus`"
        );
        assert.deepStrictEqual([...judgedBy], ["opus"]);
        const fs = yield* FileSystem.FileSystem;
        assert.include(
          yield* fs.readFileString(`${gaps}/g01-empty.md`),
          "reviewed by opus, gpt-6.1-sol, judged by opus, effort high"
        );
      }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(byModel))));
    }
  );
});
