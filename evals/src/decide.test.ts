import { assert, describe, it } from "@effect/vitest";
import { answerTo } from "./decide.ts";

const card = {
  id: "g05",
  options: [
    { key: "rule", label: "Write a rule" },
    { key: "taste", label: "My taste: close it" },
  ],
  title: "Is more depth a rule or your taste?",
};

describe("decide", () => {
  it("keeps an answer with its option's label and the card's title, so the file reads alone", () => {
    assert.deepStrictEqual(
      answerTo(
        card,
        { choice: "taste", comment: "  it is  " },
        "2026-11-03T10:00:00.000Z"
      ),
      {
        at: "2026-11-03T10:00:00.000Z",
        choice: "taste",
        comment: "it is",
        label: "My taste: close it",
        title: "Is more depth a rule or your taste?",
      }
    );
    assert.notProperty(
      answerTo(card, { choice: "rule", comment: " " }, "t"),
      "comment"
    );
  });

  it("refuses a choice the card doesn't offer", () => {
    assert.strictEqual(
      answerTo(card, { choice: "maybe" }, "t"),
      "g05 has no option maybe"
    );
  });
});
