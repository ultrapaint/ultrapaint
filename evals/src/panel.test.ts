import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Browser } from "./browser.ts";
import { type Asked, Models } from "./models.ts";
import { PanelResult, panel } from "./panel.ts";
import { judgement, readData, TestData, writeData } from "./test-data.ts";

const box = { height: 0.2, width: 1, x: 0, y: 0 };
const RUN = "runs/r/share/run-";

/** A round of two runs of one reference, cut into a header and a footer, judged and timed. */
const aRound = (score: (run: number) => number) =>
  writeData({
    "references/share/brief.md": "Title: Share this workspace",
    "references/share/sections.json": {
      sections: ["Header", "Footer"].map((name) => ({
        box,
        name,
        picture: "desktop-fold.jpg",
        what: `The ${name.toLowerCase()} of the dialog.`,
      })),
    },
    "runs/r/round.json": {
      agent: "claude-code",
      commit: "abc",
      host: "family",
      name: "r",
      picture: false,
      references: ["share"],
      runs: 2,
      skills: "built-in",
      startedAt: "2026-11-04T00:00:00.000Z",
    },
    ...Object.fromEntries(
      [1, 2].flatMap((run) => [
        [
          `${RUN}${run}/run.json`,
          {
            agent: "claude-code",
            mcpCalls: 0,
            models: {},
            pages: ["/"],
            problems: [],
            seconds: 100 * run,
            tokens: 2000 * run,
            toolCalls: 0,
          },
        ],
        [
          `${RUN}${run}/judge.json`,
          judgement({ layout: 4, overall: score(run) }),
        ],
        [
          `${RUN}${run}/sections.json`,
          {
            sections: ["Header", "Footer"].map((name) => ({
              box,
              missing: false,
              name,
              picture: "desktop-01.jpg",
            })),
          },
        ],
        [`${RUN}${run}/shots/sections/header.jpg`, "a picture"],
        [`${RUN}${run}/shots/sections/footer.jpg`, "a picture"],
      ])
    ),
  });

const finding = (title: string) => ({
  fix: "Fix it.",
  problem: `${title} is wrong.`,
  title,
  where: "there",
});
const LABEL_RE = /^(F\d+)\./gm;

/**
 * In run 1 both panel models find the header's contrast, which the grouping makes one problem,
 * and Opus also a cramped footer; run 2 is clean.
 */
const script = (asked: Asked[]) => (question: Asked) => {
  asked.push(question);
  if (question.prompt.startsWith("Several reviewers")) {
    return {
      problems: [
        {
          ...finding("Low contrast"),
          findings: [...question.prompt.matchAll(LABEL_RE)].map((m) => m[1]),
        },
      ],
    };
  }
  if (!question.cwd.includes("run-1")) {
    return { findings: [], systemNotes: [] };
  }
  if (question.prompt.includes("The section: Header.")) {
    return {
      findings: [finding("Low contrast")],
      systemNotes: [{ component: "Dialog", note: "Its title is too small." }],
    };
  }
  return {
    findings: question.model === "opus" ? [finding("Cramped footer")] : [],
    systemNotes: [],
  };
};

const options = {
  concurrency: 2,
  effort: "high",
  judgeModel: "opus",
  models: ["opus", "gpt-6.1-sol"],
};

describe("the panel", () => {
  it.effect(
    "counts what the panel still finds per run and per section, its findings grouped into problems, beside the judge's score and the run's cost",
    () => {
      const asked: Asked[] = [];
      return Effect.gen(function* () {
        yield* aRound((run) => 5 - run);
        yield* panel(["r"], options);

        const saved = PanelResult.make(
          JSON.parse(yield* readData(`${RUN}1/panel.json`))
        );
        assert.deepStrictEqual(
          saved.sections.map((s) => [
            s.name,
            s.problems.map((p) => [p.title, p.reviewers]),
          ]),
          [
            ["Header", [["Low contrast", ["gpt-6.1-sol", "opus"]]]],
            ["Footer", [["Cramped footer", ["opus"]]]],
          ]
        );
        // What only the dialog would fix is a note, once per section, not a problem.
        assert.deepStrictEqual(saved.sections[0]?.systemNotes, [
          {
            component: "Dialog",
            note: "Its title is too small.",
            reviewer: "opus",
          },
        ]);
        assert.isTrue(saved.withRequest);
        // The panel reviews within the brief the designer was given; the round gave no picture.
        const reviewed = asked.filter((q) => q.prompt.startsWith("You review"));
        assert.isNotEmpty(reviewed);
        for (const question of reviewed) {
          assert.include(
            question.prompt,
            "<brief>\nTitle: Share this workspace\n</brief>"
          );
          assert.notInclude(question.prompt, "decide the look");
        }
        // Only the header of run 1 has two models' findings to group.
        assert.strictEqual(
          asked.filter((q) => q.prompt.startsWith("Several reviewers")).length,
          1
        );

        const table = yield* readData("runs/r/panel.md");
        assert.include(
          table,
          "| Run | Problems | opus | gpt-6.1-sol | Notes | Fidelity | Seconds | Review seconds | Tokens |"
        );
        assert.include(
          table,
          "| share/run-1 | **2** | 2 | 1 | 1 | 4 | 100 | – | 2k |"
        );
        assert.include(
          table,
          "| share/run-2 | **0** | 0 | 0 | 0 | 3 | 200 | – | 4k |"
        );
        assert.include(
          table,
          "| **Mean** | **1.0** | 1.0 | 0.5 | 0.5 | 3.5 | 150.0 | – |  |"
        );
        assert.include(table, "| Section | share/run-1 | share/run-2 | Mean |");
        assert.include(table, "| Header | 1 | 0 | 0.5 |");
        assert.include(table, "| Footer | 1 | 0 | 0.5 |");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestData,
            Browser.layerTest,
            Models.layerTest(script(asked))
          )
        )
      );
    }
  );

  it.effect("keeps a run's result while the panel is the same", () => {
    const asked: Asked[] = [];
    return Effect.gen(function* () {
      yield* aRound(() => 4);
      yield* panel(["r"], options);
      const before = asked.length;
      yield* panel(["r"], { ...options, models: ["gpt-6.1-sol", "opus"] });
      assert.strictEqual(asked.length, before);
      yield* panel(["r"], { ...options, models: ["opus"] });
      assert.isAbove(asked.length, before);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestData,
          Browser.layerTest,
          Models.layerTest(script(asked))
        )
      )
    );
  });
});
