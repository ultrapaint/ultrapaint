import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Deck } from "./decide.ts";
import { fixes, panelsOf, realProblems } from "./fixes.ts";
import { type Asked, Models } from "./models.ts";
import { ratingId } from "./recall.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const card = (section: string, title: string, fix: string) => ({
  body: `${title} is wrong.\n\nWould a careful designer fix this here?`,
  id: ratingId(section, title),
  options: [
    { key: "real", label: "Real" },
    { key: "noise", label: "Noise" },
  ],
  pictures: [{ caption: "the panel", src: `gaps/sections/${section}/p.png` }],
  proposal: `**I'd fix it.** ${fix}\n\nThe skill: SKILL.md`,
  recommend: "real",
  title,
});

const real = (title: string) => ({
  at: "t",
  choice: "real",
  label: "Real",
  title,
});

describe("fixes", () => {
  it("groups the sections whose code shares a file other than DESIGN.md into one panel", () => {
    assert.deepStrictEqual(
      panelsOf(
        new Map([
          ["changes-after", ["DESIGN.md", "apps/web/changes.tsx"]],
          [
            "changes-fixed",
            ["DESIGN.md", "apps/web/changes.tsx", "ui/checkbox.tsx"],
          ],
          ["layers", ["DESIGN.md", "apps/web/layers.tsx"]],
        ])
      ),
      [["changes-after", "changes-fixed"], ["layers"]]
    );
  });

  it("reads what a deck's answers call real, with the problem and the fix of the card's call", () => {
    const deck = {
      cards: [
        card("panel", "Heavy group", "Lighten it."),
        card("panel", "Hairline", "Drop it."),
      ],
      title: "d",
    };
    const found = realProblems(deck, {
      [ratingId("panel", "Heavy group")]: real("Heavy group"),
    });
    assert.deepStrictEqual(
      found.map((p) => [p.section, p.problem, p.fix]),
      [["panel", "Heavy group is wrong.", "Lighten it."]]
    );
  });

  it.effect(
    "asks once per panel, and writes a card for each problem that still holds, the smallest fix first",
    () => {
      const asked: Asked[] = [];
      const model = (question: Asked) => {
        asked.push(question);
        return {
          problems: [
            {
              fix: "Lighten the group label.",
              holds: "yes",
              n: 1,
              same: 0,
              size: "medium",
              where: "a.tsx:3",
            },
            {
              fix: "",
              holds: "yes",
              n: 2,
              same: 1,
              size: "medium",
              where: "a.tsx:3",
            },
            { fix: "", holds: "no", n: 3, same: 0, size: "small", where: "" },
            {
              fix: "Drop the second count.",
              holds: "yes",
              n: 4,
              same: 0,
              size: "small",
              where: "a.tsx:9",
            },
          ],
        };
      };
      const section = {
        code: ["code/DESIGN.md", "code/apps/web/a.tsx"],
        commit: "abc1234",
        name: "The panel",
        pictures: [{ file: "pictures/p.png", shows: "the panel" }],
        where: "A panel.",
      };
      const titles = [
        "Heavy group",
        "Group too heavy",
        "Gone already",
        "Count twice",
      ];
      return Effect.gen(function* () {
        yield* writeData({
          "decisions/rate-r.answers.json": Object.fromEntries(
            titles.map((t) => [
              ratingId(t === "Group too heavy" ? "b" : "a", t),
              real(t),
            ])
          ),
          "decisions/rate-r.json": {
            cards: titles.map((t) =>
              card(t === "Group too heavy" ? "b" : "a", t, `Fix ${t}.`)
            ),
            title: "r",
          },
          "gaps/sections/a/section.json": section,
          "gaps/sections/b/section.json": section,
        });
        const options = {
          concurrency: 1,
          effort: "high",
          model: "opus",
          name: "fixes-test",
          rounds: ["r"],
        };
        yield* fixes(options);
        assert.strictEqual(asked.length, 1);
        assert.include(asked[0]?.prompt ?? "", "- `apps/web/a.tsx`");
        assert.include(asked[0]?.prompt ?? "", "**Group too heavy** (b)");
        const deck = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Deck)
        )(yield* readData("decisions/fixes-test.json"));
        assert.deepStrictEqual(
          deck.cards.map((c) => [c.title, c.proposal]),
          [
            ["Count twice", "**I'd fix it.** Drop the second count."],
            ["Heavy group", "**I'd fix it.** Lighten the group label."],
          ]
        );
        yield* fixes(options);
        assert.strictEqual(asked.length, 1);
      }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(model))));
    }
  );
});
