/**
 * Questions to the user, as an elicitation form and back.
 *
 * An MCP server asks the user through the agent that called it: the editor's `ask_user` returns
 * a form, the agent passes it to its ACP client — the editor again — and the answers make the
 * same trip back. The form is JSON Schema restricted to flat fields (MCP and ACP agree on the
 * kinds); the editor draws it as the question card it already has. These are the two
 * translations, one for each end, and they are kept together so that they stay each other's
 * inverse. Pure: no Effect, no I/O.
 *
 * A question that takes an answer of the user's own as well as its options has no field kind of
 * its own, so it is two fields: the options under its id, the text under `<id>:other`. The card
 * puts them back together.
 */

import type {
  Answer,
  Answers,
  Question,
  QuestionOption,
} from "@ultrapaint/contracts/threads";
import type { Json } from "effect/Schema";

const OTHER = ":other";

/** The field of the answer the user typed instead of picking an option. */
const otherOf = (id: string) => `${id}${OTHER}`;

/** A value of the content an elicitation is answered with. */
export type ContentValue = string | number | boolean | string[];

/** A JSON Schema of flat fields, as MCP and ACP restrict an elicitation's form. */
export interface ElicitationForm {
  readonly properties: { [key: string]: Json };
  readonly required: string[];
  readonly type: "object";
  readonly [key: string]: Json;
}

const titled = (option: QuestionOption): Json => ({
  const: option.id,
  title: option.label,
  ...(option.description ? { description: option.description } : {}),
});

/** Questions as the form an elicitation asks with. */
export const formOf = (questions: readonly Question[]): ElicitationForm => {
  const properties: { [key: string]: Json } = {};
  const required: string[] = [];
  for (const question of questions) {
    const about = {
      title: question.question,
      ...(question.description ? { description: question.description } : {}),
    };
    const { options } = question;
    if (options.length === 0) {
      properties[question.id] = { ...about, type: "string" };
    } else if (question.multiple) {
      properties[question.id] = {
        ...about,
        items: { anyOf: options.map(titled) },
        type: "array",
      };
    } else {
      properties[question.id] = {
        ...about,
        oneOf: options.map(titled),
        type: "string",
      };
    }
    // Either field answers it, so neither is required on its own.
    if (question.allowOther && options.length > 0) {
      properties[otherOf(question.id)] = {
        title: `${question.question} (an answer of your own)`,
        type: "string",
      };
    } else if (!question.optional) {
      required.push(question.id);
    }
  }
  return { properties, required, type: "object" };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Options from `oneOf`/`anyOf` titled entries, or from a plain `enum`. */
const optionsOf = (field: Record<string, unknown>) => {
  const titledOptions = field.oneOf ?? field.anyOf;
  if (Array.isArray(titledOptions)) {
    return titledOptions.filter(isRecord).map(
      (entry): QuestionOption => ({
        id: String(entry.const),
        label: text(entry.title) ?? String(entry.const),
        ...(text(entry.description)
          ? { description: text(entry.description) }
          : {}),
      })
    );
  }
  if (Array.isArray(field.enum)) {
    const names = Array.isArray(field.enumNames) ? field.enumNames : [];
    return field.enum.map(
      (value, index): QuestionOption => ({
        id: String(value),
        label: text(names[index]) ?? String(value),
      })
    );
  }
  return null;
};

const YES_NO: readonly QuestionOption[] = [
  { id: "true", label: "Yes" },
  { id: "false", label: "No" },
];

/** The question one field of a form asks, or null when the card has no input for it. */
const questionOf = (
  key: string,
  field: Record<string, unknown>,
  required: boolean,
  withOther: boolean
): Question | null => {
  const base = {
    id: key,
    question: text(field.title) ?? key,
    ...(text(field.description)
      ? { description: text(field.description) }
      : {}),
    ...(withOther ? { allowOther: true } : {}),
    ...(required || withOther ? {} : { optional: true }),
  };
  switch (field.type) {
    case "string":
      return { ...base, options: optionsOf(field) ?? [] };
    case "number":
    case "integer":
      return { ...base, options: [], value: field.type };
    case "boolean":
      return { ...base, options: YES_NO, value: "boolean" };
    case "array": {
      const options = isRecord(field.items) ? optionsOf(field.items) : null;
      return options === null ? null : { ...base, multiple: true, options };
    }
    default:
      return null;
  }
};

/**
 * The questions a form asks, or null when it has a field the card cannot draw: such an
 * elicitation is declined rather than half answered.
 */
export const questionsOf = (form: unknown): Question[] | null => {
  if (!(isRecord(form) && isRecord(form.properties))) {
    return null;
  }
  const fields = form.properties;
  const required = new Set(
    Array.isArray(form.required)
      ? form.required.filter((k) => typeof k === "string")
      : []
  );
  const isOther = (key: string) =>
    key.endsWith(OTHER) && isRecord(fields[key.slice(0, -OTHER.length)]);
  const questions: Question[] = [];
  for (const [key, field] of Object.entries(fields)) {
    if (isOther(key)) {
      continue;
    }
    const question = isRecord(field)
      ? questionOf(
          key,
          field,
          required.has(key),
          isRecord(fields[otherOf(key)])
        )
      : null;
    if (question === null) {
      return null;
    }
    questions.push(question);
  }
  return questions;
};

const first = (answer: Answer) =>
  typeof answer === "string" ? answer : (answer[0] ?? "");

/** The card's answers as the content an elicitation is answered with, typed as the form says. */
export const contentOf = (
  questions: readonly Question[],
  answers: Answers
): Record<string, ContentValue> => {
  const content: Record<string, ContentValue> = {};
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer === undefined || answer.length === 0) {
      continue;
    }
    const one = first(answer);
    if (question.multiple) {
      content[question.id] =
        typeof answer === "string" ? [answer] : [...answer];
    } else if (question.value === "boolean") {
      content[question.id] = one === "true";
    } else if (question.value === "number" || question.value === "integer") {
      content[question.id] = Number(one);
    } else if (
      question.allowOther &&
      !question.options.some((o) => o.id === one)
    ) {
      content[otherOf(question.id)] = one;
    } else {
      content[question.id] = one;
    }
  }
  return content;
};

/** The content an elicitation was answered with, as answers to the questions it asked. */
export const answersOf = (
  questions: readonly Question[],
  content: unknown
): Answers => {
  const values = isRecord(content) ? content : {};
  const answers: Record<string, Answer> = {};
  for (const question of questions) {
    const typed = values[otherOf(question.id)];
    const value = values[question.id];
    if (typeof typed === "string" && typed.length > 0) {
      answers[question.id] = typed;
    } else if (Array.isArray(value)) {
      answers[question.id] = value.map(String);
    } else if (value !== undefined && value !== null) {
      answers[question.id] = String(value);
    }
  }
  return answers;
};

/** What an answer reads as: each option's label, with its id when that says something else. */
const shownOf = (question: Question, answer: Answer | undefined) => {
  if (answer === undefined || answer.length === 0) {
    return "(no answer)";
  }
  const shown = (one: string) => {
    const option = question.options.find((o) => o.id === one);
    if (option === undefined) {
      return one;
    }
    return option.label === option.id
      ? option.label
      : `${option.label} [${option.id}]`;
  };
  return typeof answer === "string"
    ? shown(answer)
    : answer.map(shown).join(", ");
};

/** The answers as the agent reads them: one line per question. */
export const answersText = (questions: readonly Question[], answers: Answers) =>
  [
    "Answers to your questions:",
    ...questions.map(
      (question, index) =>
        `${index + 1}. ${question.question} — ${shownOf(question, answers[question.id])}`
    ),
  ].join("\n");
