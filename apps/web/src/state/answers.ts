/**
 * Answers being given to an agent's questions. A card asks its questions one at a time, and the
 * thread's composer takes part: what is typed in it is the answer of one's own to the question on
 * screen, and its send button steps to the next question, then sends them all. Card and composer
 * are far apart in the panel, so what is picked lives here, by card.
 */
import { create } from "zustand";
import {
  type AnswerDraft,
  answerOf,
  type QuestionItem,
  type QuestionOf,
} from "../lib/answers.ts";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

const EMPTY: AnswerDraft = { busy: false, other: {}, picked: {}, step: 0 };

export const useAnswers = create<{ drafts: Record<string, AnswerDraft> }>(
  () => ({ drafts: {} })
);

export const draftOf = (
  drafts: Readonly<Record<string, AnswerDraft>>,
  itemId: string
) => drafts[itemId] ?? EMPTY;

const update = (itemId: string, f: (draft: AnswerDraft) => AnswerDraft) =>
  useAnswers.setState((s) => ({
    drafts: { ...s.drafts, [itemId]: f(draftOf(s.drafts, itemId)) },
  }));

/** Picks an option: the only one of a question, or one more (or one less) of a `multiple` one. */
export const pick = (itemId: string, question: QuestionOf, id: string) =>
  update(itemId, (d) => {
    if (!question.multiple) {
      // Picking says what the answer is: a typed one gives way.
      return {
        ...d,
        other: { ...d.other, [question.id]: "" },
        picked: { ...d.picked, [question.id]: id },
      };
    }
    const now = [d.picked[question.id] ?? []].flat();
    return {
      ...d,
      picked: {
        ...d.picked,
        [question.id]: now.includes(id)
          ? now.filter((one) => one !== id)
          : [...now, id],
      },
    };
  });

export const setOther = (itemId: string, question: QuestionOf, text: string) =>
  update(itemId, (d) => ({ ...d, other: { ...d.other, [question.id]: text } }));

export const setStep = (item: QuestionItem, step: number) =>
  update(item.id, (d) => ({
    ...d,
    step: Math.max(0, Math.min(step, item.questions.length - 1)),
  }));

const run = async (itemId: string, request: () => Promise<unknown>) => {
  update(itemId, (d) => ({ ...d, busy: true }));
  try {
    await request();
  } catch (error) {
    reportError(error);
  }
  update(itemId, (d) => ({ ...d, busy: false }));
};

export const sendAnswers = (item: QuestionItem, threadId: string) => {
  const draft = draftOf(useAnswers.getState().drafts, item.id);
  return run(item.id, () =>
    api().request("threads.answer", {
      answers: Object.fromEntries(
        item.questions.flatMap((q) => {
          const answer = answerOf(draft, q);
          return answer === undefined ? [] : [[q.id, answer]];
        })
      ),
      itemId: item.id,
      threadId,
    })
  );
};

export const declineQuestions = (item: QuestionItem, threadId: string) =>
  run(item.id, () =>
    api().request("threads.decline", { itemId: item.id, threadId })
  );
