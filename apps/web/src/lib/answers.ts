/**
 * What answering an agent's questions comes to, without the store: which card is open, whether
 * what was picked or typed answers a question, and what the cards no longer waiting say.
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

/** A card still waiting: neither answered, declined, nor withdrawn by the agent. */
export const isOpenQuestion = (item: QuestionItem) =>
  item.answers === null && item.outcome === undefined;

/** The card the composer answers: the oldest one still waiting for answers. */
export const openQuestionOf = (items: readonly ThreadItem[]) =>
  items.find(
    (i): i is QuestionItem => i.kind === "question" && isOpenQuestion(i)
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

/** Whether an answer of one's own may be typed for this question: always, as in T3 Code (ADR 0140). */
export const takesTyping = (question: QuestionOf) =>
  question.options.length === 0 || question.allowOther !== false;

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

/** What an answer reads as once given: each option's label, or the text typed; none when empty. */
export const answerText = (
  question: QuestionOf,
  answer: Answer | undefined
): string | undefined => {
  if (answer === undefined || answer.length === 0) {
    return;
  }
  const label = (one: string) =>
    question.options.find((o) => o.id === one)?.label ?? one;
  return typeof answer === "string"
    ? label(answer)
    : answer.map(label).join(", ");
};

/**
 * How a card no longer waiting ended, when none of its questions has an answer: sent with every
 * question skipped (each optional), declined, or let go.
 */
const endOf = (item: QuestionItem) => {
  if (item.answers !== null) {
    return "Skipped";
  }
  return item.outcome === "declined" ? "Declined" : "No longer asked";
};

/** Whether a card holds an answer to any of its questions. */
const hasAnswer = (item: QuestionItem) =>
  item.questions.some((q) => answerText(q, item.answers?.[q.id]) !== undefined);

/**
 * What a turn's questions no longer waiting come to, as the one row that folds them reads
 * (ADR 0129): the answers given, in the order asked; how the cards without answers ended, each
 * once; how many questions went unanswered; whether answers may not have reached the agent.
 */
export const askedSummary = (asked: readonly QuestionItem[]) => {
  const answers = asked.flatMap((card) =>
    card.questions.flatMap((q) => {
      const text = answerText(q, card.answers?.[q.id]);
      return text === undefined ? [] : [text];
    })
  );
  const questions = asked.reduce((n, card) => n + card.questions.length, 0);
  return {
    answers,
    ends: [...new Set(asked.filter((card) => !hasAnswer(card)).map(endOf))],
    lost: asked.some((card) => card.outcome === "undelivered"),
    unanswered: questions - answers.length,
  };
};
