import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import {
  type AnswerDraft,
  answeredWell,
  answerOf,
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
  it("is what was typed, over what was picked, when it takes typing", () => {
    const open = { ...choice, allowOther: true };
    const d = draft({ other: { q: " mine " }, picked: { q: "a" } });
    expect(answerOf(d, open)).toBe("mine");
  });

  it("ignores typing a question does not take", () => {
    const d = draft({ other: { q: "mine" }, picked: { q: "a" } });
    expect(answerOf(d, choice)).toBe("a");
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
