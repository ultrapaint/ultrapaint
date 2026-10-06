/**
 * What answering an agent's questions comes to, without the store: which card is open, and
 * whether what was picked or typed answers a question.
 */
import type { Answer, ThreadItem } from "@ultrapaint/contracts/threads";

export type QuestionItem = Extract<ThreadItem, { kind: "question" }>;
export type QuestionOf = QuestionItem["questions"][number];

/** What one card has been given so far. */
export interface AnswerDraft {
  /** A request is on its way: the card waits for the server. */
  readonly busy: boolean;
  /** Question id → the answer typed in the composer instead. */
  readonly other: Readonly<Record<string, string>>;
  /** Question id → the option, or the options, picked. */
  readonly picked: Readonly<Record<string, Answer>>;
  /** The question on screen, by index. */
  readonly step: number;
}

/** The card the composer answers: the oldest one still waiting for answers. */
export const openQuestionOf = (items: readonly ThreadItem[]) =>
  items.find(
    (i): i is QuestionItem =>
      i.kind === "question" && i.answers === null && i.outcome === undefined
  ) ?? null;

/** An answer typed for a number question that is not one. */
export const notANumber = (question: QuestionOf, typed: string) => {
  if (question.value !== "number" && question.value !== "integer") {
    return false;
  }
  const value = Number(typed);
  return (
    !Number.isFinite(value) ||
    (question.value === "integer" && !Number.isInteger(value))
  );
};

/** Whether an answer of one's own may be typed for this question. */
export const takesTyping = (question: QuestionOf) =>
  question.options.length === 0 || question.allowOther === true;

/** The answer a question has: what was typed, when anything was, or what was picked. */
export const answerOf = (
  draft: AnswerDraft,
  question: QuestionOf
): Answer | undefined => {
  const typed = draft.other[question.id]?.trim();
  return typed && takesTyping(question) ? typed : draft.picked[question.id];
};

/** Whether a question may be left as it is: answered with something that fits, or optional. */
export const answeredWell = (draft: AnswerDraft, question: QuestionOf) => {
  const answer = answerOf(draft, question);
  if (answer === undefined || answer.length === 0) {
    return question.optional === true;
  }
  return typeof answer !== "string" || !notANumber(question, answer);
};
