import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Asked } from "./models.ts";
import { Models } from "./models.ts";
import {
  flipsOf,
  pairwise,
  settled,
  shownAs,
  skillReads,
  tallyOf,
  unblind,
} from "./pairwise.ts";
import { readData, TestData, writeData } from "./test-data.ts";

/** A judge that always prefers the design it is shown first. */
const firstShown = (_: Asked) => ({
  levels: { layout: "A" },
  margin: "clear",
  reasons: [],
  winner: "A",
});

const twoRounds = {
  "references/home/capture/home.jpg": "jpg",
  "runs/a/home/run-1/shots/home.jpg": "jpg",
  "runs/b/home/run-1/shots/home.jpg": "jpg",
};

describe("pairwise", () => {
  it("shows a run's two designs in the order its name gives, as the rounds judged so far were", () => {
    // From runs/r2-main-blank-vs-r2-ch-blank/pairwise.json: each run's `shownFirst`.
    assert.deepStrictEqual(
      shownAs("r2-main-blank", "r2-ch-blank", "alignui-waitlist/run-1"),
      ["r2-main-blank", "r2-ch-blank"]
    );
    assert.deepStrictEqual(
      shownAs("r2-main-blank", "r2-ch-blank", "austrace-contact/run-1"),
      ["r2-ch-blank", "r2-main-blank"]
    );
    assert.deepStrictEqual(
      shownAs("r2-main-blank", "r2-ch-blank", "baserow-grid/run-1"),
      ["r2-main-blank", "r2-ch-blank"]
    );
  });

  it("turns the judge's letters into the rounds they were shown as, a tie staying a tie", () => {
    const verdict = {
      levels: { colour: "B", layout: "A", spacing: "tie" },
      margin: "slight",
      reasons: ["B's table reads first"],
      winner: "B",
    } as const;
    assert.deepStrictEqual(unblind(verdict, ["candidate", "baseline"]), {
      levels: { colour: "baseline", layout: "candidate", spacing: "tie" },
      margin: "slight",
      reasons: ["B's table reads first"],
      shownFirst: "candidate",
      winner: "baseline",
    });
    assert.deepStrictEqual(
      unblind({ ...verdict, winner: "tie" }, ["baseline", "candidate"]).winner,
      "tie"
    );
  });

  it("tallies the runs each round won, overall and level by level", () => {
    const judged = (
      winner: string,
      levels: Readonly<Record<string, string>>
    ) => ({ levels, margin: "clear", reasons: [], shownFirst: "a", winner });
    assert.deepStrictEqual(
      tallyOf({
        "home/run-1": judged("a", { colour: "tie", layout: "a" }),
        "home/run-2": judged("b", { colour: "b", layout: "a" }),
        "pricing/run-1": judged("a", { colour: "b", layout: "a" }),
      }),
      {
        a: 2,
        b: 1,
        "colour:b": 2,
        "colour:tie": 1,
        "layout:a": 3,
      }
    );
  });

  it("reads the skill's files a trace opened from the skill's cache, each once, by their paths in the skill", () => {
    const cache = "/home/me/.cache/ultrapaint/skills/abc";
    const trace = [
      `- · Read ${cache}/SKILL.md`,
      `- · Read ${cache}/references/kinds/dialog.md`,
      `- · Read ${cache}/SKILL.md`,
      `- · Read ${cache}/references/system/foundations.md and references/color.md`,
      "- · Read /home/me/project/notes.md",
      "- ✗ get_screenshot",
    ].join("\n");
    assert.deepStrictEqual(skillReads(trace), [
      "SKILL.md",
      "references/color.md",
      "references/kinds/dialog.md",
      "references/system/foundations.md",
    ]);
    assert.deepStrictEqual(skillReads(""), []);
  });

  it("reads each file of a brace list, a variable's files, and a call that failed after its read", () => {
    const cache = "/home/me/.cache/ultrapaint/skills/abc";
    const trace = [
      `- · cat ${cache}/references/{layout,spacing}.md ${cache}/references/words/{voice,interface}.md`,
      `- ✗ S=${cache}; cat $S/references/typography.md; ls nowhere`,
      `- · ls ${cache}/references/*.md`,
    ].join("\n");
    assert.deepStrictEqual(skillReads(trace), [
      "references/layout.md",
      "references/spacing.md",
      "references/typography.md",
      "references/words/interface.md",
      "references/words/voice.md",
    ]);
  });

  it("reads a trace from before the cache held the whole skill as the references it held", () => {
    const cache = "/home/me/.cache/ultrapaint/skills/abc";
    const trace = [
      `- · Read ${cache}/with-tools/design-system/components.md`,
      `- ✗ cat ${cache}/with-tools/references/patterns/navigation.md`,
      `- ✗ S=${cache}/with-tools; cat $S/typography.md; ls nowhere`,
      `- · Read ${cache}/layout.md`,
    ].join("\n");
    assert.deepStrictEqual(skillReads(trace), [
      "references/design-system/components.md",
      "references/layout.md",
      "references/typography.md",
    ]);
  });

  it("lets a side stand only when both orders gave it, and counts the winners that changed", () => {
    const run = {
      levels: { colour: "b", layout: "a" },
      margin: "clear",
      reasons: [],
      shownFirst: "a",
      winner: "a",
    };
    const swapped = {
      ...run,
      levels: { colour: "b", layout: "b" },
      winner: "b",
    };
    assert.deepStrictEqual(settled(run), {
      levels: { colour: "b", layout: "a" },
      winner: "a",
    });
    assert.deepStrictEqual(settled({ ...run, swapped }), {
      levels: { colour: "b", layout: "tie" },
      winner: "tie",
    });
    const results = {
      "home/run-1": { ...run, swapped },
      "home/run-2": { ...run, swapped: run },
      "home/run-3": run,
    };
    assert.deepStrictEqual(flipsOf(results), { both: 2, flipped: 1 });
    assert.deepStrictEqual(tallyOf(results), {
      a: 2,
      "colour:b": 3,
      "layout:a": 2,
      "layout:tie": 1,
      tie: 1,
    });
  });

  it.effect(
    "judges a run both ways round, so a judge that prefers what it sees first settles nothing",
    () =>
      Effect.gen(function* () {
        yield* writeData(twoRounds);
        yield* pairwise("a", "b", { model: "opus" });
        const results = JSON.parse(
          yield* readData("runs/a-vs-b/pairwise.json")
        );
        const run = results["home/run-1"];
        assert.notStrictEqual(run.shownFirst, run.swapped.shownFirst);
        assert.strictEqual(run.winner, run.shownFirst);
        assert.strictEqual(run.swapped.winner, run.swapped.shownFirst);
        assert.deepStrictEqual(settled(run), {
          levels: { layout: "tie" },
          winner: "tie",
        });
      }).pipe(
        Effect.provide(Layer.merge(TestData, Models.layerTest(firstShown)))
      )
  );

  it.effect(
    "asks only the order a run lacks: a run judged one way before is judged the other way, once",
    () =>
      Effect.gen(function* () {
        let asked = 0;
        const counting = (question: Asked) => {
          asked += 1;
          return firstShown(question);
        };
        yield* Effect.gen(function* () {
          yield* writeData(twoRounds);
          yield* pairwise("a", "b", { model: "opus", oneOrder: true });
          assert.strictEqual(asked, 1);
          yield* pairwise("a", "b", { model: "opus", oneOrder: true });
          assert.strictEqual(asked, 1);
          yield* pairwise("a", "b", { model: "opus" });
          assert.strictEqual(asked, 2);
          yield* pairwise("a", "b", { model: "opus" });
          assert.strictEqual(asked, 2);
        }).pipe(
          Effect.provide(Layer.merge(TestData, Models.layerTest(counting)))
        );
      })
  );
});
