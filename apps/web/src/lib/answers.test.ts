import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import {
  type AnswerDraft,
  answeredWell,
  answerOf,
  askedSummary,
  openQuestionOf,
  type QuestionItem,
  type QuestionOf,
} from "./answers.ts";

const draft = (d: Partial<AnswerDraft> = {}): AnswerDraft => ({
  busy: false,
  other: {},
  picked: {},
  step: 0,
  ...d,
});

const choice: QuestionOf = {
  id: "q",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  question: "Which?",
};

const card = (id: string, rest: Partial<QuestionItem> = {}): QuestionItem => ({
  answers: null,
  at: 0,
  id,
  kind: "question",
  questions: [choice],
  ...rest,
});

describe("the card the composer answers", () => {
  it("is the oldest one still waiting", () => {
    const items: ThreadItem[] = [
      card("answered", { answers: { q: "a" } }),
      card("declined", { outcome: "declined" }),
      card("first"),
      card("second"),
    ];
    expect(openQuestionOf(items)?.id).toBe("first");
  });

  it("is the copy the agent asked last, once the older one reads no longer asked (ADR 0125)", () => {
    const items: ThreadItem[] = [
      card("older", {
        elicitation: { message: "The agent asks" },
        outcome: "cancelled",
        settled: { at: 2, how: "repeated" },
      }),
      card("live", { elicitation: { message: "The agent asks" } }),
    ];
    expect(openQuestionOf(items)?.id).toBe("live");
  });

  it("is never one whose answers could not be delivered", () => {
    const items: ThreadItem[] = [
      card("lost", { answers: { q: "a" }, outcome: "undelivered" }),
    ];
    expect(openQuestionOf(items)).toBeNull();
  });

  it("is none once every card is answered", () => {
    expect(openQuestionOf([card("done", { answers: {} })])).toBeNull();
  });
});

describe("a question's answer", () => {
  it("is what was typed, over what was picked, on any question with options (ADR 0140)", () => {
    const d = draft({ other: { q: " mine " }, picked: { q: "a" } });
    expect(answerOf(d, choice)).toBe("mine");
    expect(answeredWell(draft({ other: { q: "mine" } }), choice)).toBe(true);
  });

  it("ignores typing only on a question that says an option alone answers it", () => {
    const closed = { ...choice, allowOther: false };
    const d = draft({ other: { q: "mine" }, picked: { q: "a" } });
    expect(answerOf(d, closed)).toBe("a");
  });

  it("is missing until given, unless the question is optional", () => {
    expect(answeredWell(draft(), choice)).toBe(false);
    expect(answeredWell(draft(), { ...choice, optional: true })).toBe(true);
    expect(answeredWell(draft({ picked: { q: [] } }), choice)).toBe(false);
  });

  it("must be a number where a number is asked", () => {
    const amount: QuestionOf = {
      id: "q",
      options: [],
      question: "How many?",
      value: "integer",
    };
    expect(answeredWell(draft({ other: { q: "2.5" } }), amount)).toBe(false);
    expect(answeredWell(draft({ other: { q: "3" } }), amount)).toBe(true);
  });
});

describe("what a turn's questions come to, once they no longer wait (ADR 0129)", () => {
  const two: QuestionOf = { ...choice, id: "r", optional: true };

  it("reads the answers given, in the order asked, and how many went unanswered", () => {
    const summary = askedSummary([
      card("c1", { answers: { q: "b" } }),
      card("c2", {
        answers: { q: ["a", "b"] },
        questions: [{ ...choice, multiple: true }, two],
      }),
    ]);
    expect(summary.answers).toEqual(["B", "A, B"]);
    expect(summary.unanswered).toBe(1);
    expect(summary.lost).toBe(false);
  });

  it("says once how the cards without answers ended", () => {
    const summary = askedSummary([
      card("c1", { outcome: "cancelled" }),
      card("c2", { outcome: "cancelled" }),
      card("c3", { outcome: "declined" }),
    ]);
    expect(summary.answers).toEqual([]);
    expect(summary.ends).toEqual(["No longer asked", "Declined"]);
    expect(summary.unanswered).toBe(3);
  });

  it("says a card sent with every question skipped was skipped", () => {
    const summary = askedSummary([
      card("c1", { answers: {}, questions: [{ ...choice, optional: true }] }),
    ]);
    expect(summary.answers).toEqual([]);
    expect(summary.ends).toEqual(["Skipped"]);
  });

  it("knows when answers may not have reached the agent", () => {
    expect(
      askedSummary([
        card("c1", { answers: { q: "a" }, outcome: "undelivered" }),
      ]).lost
    ).toBe(true);
  });
});
