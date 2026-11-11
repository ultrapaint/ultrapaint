import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Deck, writeDeck } from "./decide.ts";
import { type Asked, Models } from "./models.ts";
import { proposalText, propose } from "./propose.ts";
import { ratingId } from "./recall.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const card = (title: string) => ({
  body: `${title}.\n\nWould a careful designer fix this here?`,
  eyebrow: "Panel",
  id: ratingId("panel", title),
  options: [
    { key: "real", label: "Real", leads: "A problem to fix" },
    { key: "noise", label: "Noise", leads: "Not a problem here" },
  ],
  title,
});

const answer = (title: string, choice: string) => ({
  at: "2026-11-11T00:00:00.000Z",
  choice,
  label: choice === "real" ? "Real" : "Noise",
  title,
});

describe("propose", () => {
  it("shows a call as what it would do and the rule it rests on", () => {
    assert.strictEqual(
      proposalText({
        call: "fix",
        n: 1,
        rule: 'SKILL.md, Restraint: "say a thing once"',
        what: "Drop the second branch name.",
      }),
      '**I\'d fix it.** Drop the second branch name.\n\nThe skill: SKILL.md, Restraint: "say a thing once"'
    );
    assert.include(
      proposalText({ call: "leave", n: 1, rule: " ", what: "Taste." }),
      "No rule of the skill settles it."
    );
  });

  it.effect(
    "asks once per section, writes each card's call into the deck, and keeps the answers given before",
    () => {
      const asked: Asked[] = [];
      const model = (question: Asked) => {
        asked.push(question);
        return {
          calls: [
            {
              call: "fix",
              n: 1,
              rule: 'SKILL.md: "say a thing once"',
              what: "Drop the repeat.",
            },
            { call: "leave", n: 2, rule: "", what: "The picture shows none." },
          ],
        };
      };
      return Effect.gen(function* () {
        yield* writeData({
          "gaps/sections/panel/section.json": {
            code: ["code/DESIGN.md"],
            commit: "abc1234",
            name: "Panel",
            pictures: [{ file: "pictures/panel@2x.png", shows: "the panel" }],
            where: "A panel of the editor.",
          },
          "runs/r/panel/unmatched.json": {
            costUsd: 0,
            value: {
              keys: [],
              problems: [
                {
                  findings: [],
                  problem: "The branch twice.",
                  title: "Branch twice",
                },
                {
                  findings: [],
                  problem: "A hairline.",
                  title: "Stray hairline",
                },
              ],
            },
          },
          "runs/r/recall.json": { models: ["opus"] },
        });
        yield* writeDeck("rate-r", {
          cards: [card("Branch twice"), card("Stray hairline")],
          intro: "Rate them.",
          title: "r: real or noise",
        });
        // Answered before the deck had calls.
        yield* writeData({
          "decisions/rate-r.answers.json": {
            [ratingId("panel", "Branch twice")]: answer("Branch twice", "real"),
          },
        });
        const options = {
          concurrency: 1,
          effort: "high",
          model: "opus",
          round: "r",
        };
        yield* propose(options);

        assert.strictEqual(asked.length, 1);
        assert.include(
          asked[0]?.prompt ?? "",
          "2. **Stray hairline**: A hairline."
        );
        assert.include(asked[0]?.prompt ?? "", "propose-skill/SKILL.md");
        const deck = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Deck)
        )(yield* readData("decisions/rate-r.json"));
        assert.deepStrictEqual(
          deck.cards.map((c) => c.recommend),
          ["real", "noise"]
        );
        assert.include(
          deck.cards[0]?.proposal ?? "",
          "**I'd fix it.** Drop the repeat."
        );
        assert.include(
          yield* readData("decisions/rate-r.answers.json"),
          "Branch twice"
        );

        // Run again, it asks nobody and says the intro once.
        yield* propose(options);
        assert.strictEqual(asked.length, 1);
        const again = JSON.parse(yield* readData("decisions/rate-r.json"));
        assert.strictEqual(again.intro.split("Each card shows").length, 2);
      }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(model))));
    }
  );
});
