import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { EvalsConfig } from "./config.ts";
import { writeText } from "./layout.ts";
import type { Asked } from "./models.ts";
import { Models } from "./models.ts";
import {
  placeOf,
  rateDeckName,
  ratingId,
  recall,
  spentLines,
  unmatchedOf,
  versionsOf,
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
  it("lays a candidate's files over the shipped skill at their paths in it", () => {
    assert.strictEqual(placeOf("SKILL.md"), "SKILL.md");
    assert.strictEqual(
      placeOf("references/kinds/dialog.md"),
      "references/kinds/dialog.md"
    );
    // As candidates were once written: a reference by its path under `references/`.
    assert.strictEqual(placeOf("states.md"), "references/states.md");
    assert.strictEqual(
      placeOf("system/figma.md"),
      "references/system/figma.md"
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

  it.effect(
    "asks no more models at once than its concurrency, however many sections it reviews",
    () => {
      let now = 0;
      let most = 0;
      // An answer takes turns of the event loop, so every review that may start beside it has.
      const aTurn = Effect.promise(
        () => new Promise<void>((resolve) => setImmediate(resolve))
      );
      const counted = Layer.effect(
        Models,
        Effect.gen(function* () {
          const models = yield* Models;
          return Models.of({
            ...models,
            ask: (question) =>
              Effect.gen(function* () {
                now += 1;
                most = Math.max(most, now);
                for (let turn = 0; turn < 20; turn += 1) {
                  yield* aTurn;
                }
                return yield* models.ask(question);
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    now -= 1;
                  })
                )
              ),
          });
        })
      ).pipe(Layer.provide(Models.layerTest(scripted)));
      return Effect.gen(function* () {
        yield* writeData(
          Object.fromEntries(
            ["a", "b", "c"].flatMap((id) => [
              [`gaps/sections/${id}/code/DESIGN.md`, "# Design\n"],
              [`gaps/sections/${id}/section.json`, section(id)],
            ])
          )
        );
        yield* recall({
          concurrency: 2,
          effort: "high",
          judgeModel: "opus",
          models: ["opus"],
          round: "c",
          runs: 2,
          sections: [],
          skills: ["built-in"],
        });
        assert.include(yield* readData("runs/c/report.md"), "### c (`c`");
        assert.isAtMost(most, 2);
      }).pipe(Effect.provide(Layer.merge(TestData, counted)));
    }
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

  it.effect(
    "says how far its counts go: each version's interval, its difference from the first, and the gaps that are not done apart",
    () =>
      Effect.gen(function* () {
        const { gaps } = yield* EvalsConfig;
        yield* writeText(
          `${gaps}/g01-empty.md`,
          gapFile("g01", "missing", "panel")
        );
        yield* writeText(
          `${gaps}/g03-closed.md`,
          gapFile("g03", "missed", "panel").replace(
            "status: open",
            "status: done"
          )
        );
        yield* writeData({
          "candidates/fix/SKILL.md": "# The candidate's router\n",
          "gaps/sections/panel/code/DESIGN.md": "# Design\n",
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
        assert.include(
          report,
          "| Version | Caught | Caught or partly | 95% interval | Against shipped |"
        );
        // The scripted judge answers for g01 alone, so g03 is judged in no run.
        assert.include(report, "| shipped | 0/2 · 0% | 0/2 · 0% | 0–0% |  |");
        assert.include(
          report,
          "| fix | 2/2 · 100% | 2/2 · 100% | 100–100% | +100 points (+100 to +100) |"
        );
        assert.include(report, "| `done` (1) | – | – |");
        assert.include(report, "| not `done` (1) | 0/2 · 0% | 2/2 · 100% |");
        assert.include(report, "`opus` judges reviews it wrote itself.");
        assert.include(
          report,
          "With 2 run(s) per section a single gap's count says little"
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "writes the deck that rates what no gap matched in the held-out sections, and counts what the person called real",
    () =>
      Effect.gen(function* () {
        const { gaps } = yield* EvalsConfig;
        yield* writeText(
          `${gaps}/g01-empty.md`,
          gapFile("g01", "missing", "panel")
        );
        yield* writeData({
          "gaps/sections/held/code/DESIGN.md": "# Design\n",
          "gaps/sections/held/section.json": section("Held"),
          "gaps/sections/panel/code/DESIGN.md": "# Design\n",
          "gaps/sections/panel/section.json": section("Panel"),
        });
        const options = {
          concurrency: 2,
          effort: "high",
          judgeModel: "opus",
          models: ["opus"],
          rate: true,
          round: "r",
          runs: 2,
          sections: [],
          skills: ["built-in"],
        };
        yield* recall(options);

        const deck = JSON.parse(
          yield* readData(`decisions/${rateDeckName("r")}.json`)
        );
        // The section a gap names is the judge's; only the held-out one is the person's to rate.
        assert.deepStrictEqual(
          deck.cards.map((c: { readonly id: string }) => c.id),
          [ratingId("held", "Stray hairline")]
        );
        assert.strictEqual(deck.cards[0].eyebrow, "Held");
        assert.strictEqual(
          deck.cards[0].pictures[0].src,
          "gaps/sections/held/pictures/panel-dark@2x.png"
        );
        const unrated = yield* readData("runs/r/report.md");
        assert.include(
          unrated,
          "| Version | Reviews | Unmatched findings per review | In held-out sections |"
        );
        assert.include(unrated, "| shipped | 4 | 1.0 | 1.0 |");

        yield* writeData({
          [`decisions/${rateDeckName("r")}.answers.json`]: {
            [ratingId("held", "Stray hairline")]: {
              at: "2026-11-10T00:00:00.000Z",
              choice: "noise",
              label: "Noise",
              title: "Stray hairline",
            },
          },
        });
        yield* recall(options);

        const rated = yield* readData("runs/r/report.md");
        assert.include(rated, "| shipped | 4 | 1.0 | 1.0 | 0/2 · 0% |");
        assert.include(
          rated,
          "| **Stray hairline.** A hairline under the title. | 2/2 | noise |"
        );
      }).pipe(Effect.provide(world))
  );
});
