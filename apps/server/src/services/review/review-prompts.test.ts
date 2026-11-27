import { describe, expect, it } from "@effect/vitest";
import { reviewerPrompt } from "./review-prompts.ts";
import type { RequestPrompt } from "./review-rounds.ts";

/** What the reviewer's prompt says the person asked. */
const askedBlock = (request: readonly RequestPrompt[]) => {
  const block = reviewerPrompt(request, []).find(
    (b) => b.type === "text" && b.text.startsWith("## What the person asked")
  );
  return block?.type === "text" ? block.text : "";
};

const LEFT_OUT = /\(The \d+ oldest of what they said are left out\.\)/;
const THIS_TURN = / turn="this">/g;
const ANSWERS = "Answers to your questions:\n1. Which plan? — Pro [pro]";

const prompt = (text: string): RequestPrompt => ({ answers: false, text });

describe("what a review model is told the person asked", () => {
  it("is the one prompt, as it always was, in a thread of one", () => {
    expect(askedBlock([prompt("A calm settings page ")])).toBe(
      "## What the person asked\n\n<request>\nA calm settings page\n</request>"
    );
  });

  it("is every prompt oldest first, the earlier still holding unless a later one changes them", () => {
    const said = askedBlock([
      prompt("A settings page for a team"),
      prompt("Focus only on the layout, leave the content empty"),
    ]);
    expect(said.indexOf("A settings page for a team")).toBeGreaterThan(-1);
    expect(said.indexOf("A settings page for a team")).toBeLessThan(
      said.indexOf("Focus only on the layout")
    );
    expect(said).toContain(
      "A later prompt changes an earlier one where the two differ, and the rest of the earlier ones still hold."
    );
  });

  it("marks their answers, and the newest prompt as this turn's", () => {
    const said = askedBlock([
      prompt("A settings page for a team"),
      { answers: true, text: ANSWERS },
      prompt("ask me again the declined questions"),
      { answers: true, inTurn: true, text: ANSWERS },
    ]);
    expect(said).toContain(`<answers>\n${ANSWERS}\n</answers>`);
    expect(said).toContain(
      '<prompt turn="this">\nask me again the declined questions\n</prompt>'
    );
    expect(said.match(THIS_TURN)).toHaveLength(1);
  });

  it("says how many of the oldest were left out", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      prompt(`${i} ${"word ".repeat(80)}`)
    );
    expect(askedBlock([...many, prompt("the newest")])).toMatch(LEFT_OUT);
  });
});
