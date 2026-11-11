import { assert, describe, it } from "@effect/vitest";
import { answerTo, OWN_ANSWER } from "./decide.ts";

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

  it("takes the person's own words as the answer when no option is chosen, and nothing as none", () => {
    assert.deepStrictEqual(
      answerTo(card, { comment: " Neither: ask me again next week " }, "t"),
      {
        at: "t",
        comment: "Neither: ask me again next week",
        label: OWN_ANSWER,
        title: "Is more depth a rule or your taste?",
      }
    );
    assert.strictEqual(
      answerTo(card, { comment: "  " }, "t"),
      "g05: an answer needs an option, or words or images of its own"
    );
  });

  it("keeps the images added to an answer, and takes images alone as the person's own answer", () => {
    assert.deepStrictEqual(
      answerTo(
        card,
        { choice: "rule", images: ["decisions/d.images/g05-a.png"] },
        "t"
      ),
      {
        at: "t",
        choice: "rule",
        images: ["decisions/d.images/g05-a.png"],
        label: "Write a rule",
        title: "Is more depth a rule or your taste?",
      }
    );
    assert.deepStrictEqual(
      answerTo(card, { images: ["decisions/d.images/g05-b.png"] }, "t"),
      {
        at: "t",
        images: ["decisions/d.images/g05-b.png"],
        label: OWN_ANSWER,
        title: "Is more depth a rule or your taste?",
      }
    );
    assert.notProperty(
      answerTo(card, { choice: "rule", images: [] }, "t"),
      "images"
    );
  });
});
