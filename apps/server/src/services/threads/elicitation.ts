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
 * Every question takes an answer of the user's own (ADR 0140). A form has no field kind for options
 * with text beside them, so each agent pairs a text field with the options' field under a name of
 * its own: the editor's `<id>:other`, Claude's `question_<n>_custom` (claude-agent-acp), Codex's
 * `<id>_note` (codex-acp, marked in its `_meta` but paired by its name too, beside a "None of the
 * above" option it adds), `<id>__other` (T3 Code reads it so). The card asks each pair as one
 * question, never the text field as a question of its own, and a typed answer goes back in the
 * paired field. A text field the form requires, or one beside a number, stays a question of its
 * own. A choice with no paired field, a yes or no too, takes the typed answer as its own value.
 */

import type {
  Answer,
  Answers,
  Question,
  QuestionOption,
} from "@ultrapaint/contracts/threads";
import { Predicate } from "effect";
import type { Json } from "effect/Schema";

const OTHER = ":other";

/** The field of the answer the user typed instead of picking an option. */
const otherOf = (id: string) => `${id}${OTHER}`;

/** A value of the content an elicitation is answered with. */
type ContentValue = string | number | boolean | string[];

/** A JSON Schema of flat fields, as MCP and ACP restrict an elicitation's form. */
interface ElicitationForm {
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
    if (question.allowOther !== false && options.length > 0) {
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

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Options from `oneOf`/`anyOf` titled entries, or from a plain `enum`. */
const optionsOf = (field: Record<string, unknown>) => {
  const titledOptions = field.oneOf ?? field.anyOf;
  if (Array.isArray(titledOptions)) {
    return titledOptions.filter(Predicate.isObject).map(
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
  optional: boolean
): Question | null => {
  const base = {
    id: key,
    question: text(field.title) ?? key,
    ...(text(field.description)
      ? { description: text(field.description) }
      : {}),
    ...(optional ? { optional: true } : {}),
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
      const options = Predicate.isObject(field.items)
        ? optionsOf(field.items)
        : null;
      return options === null ? null : { ...base, multiple: true, options };
    }
    default:
      return null;
  }
};

/** Codex's option that only says the answer is in the note (codex-acp's `USER_INPUT_OTHER_OPTION`). */
const CODEX_OTHER = "None of the above";
const CODEX_OTHER_SAYS = "Provide a different answer in the note field.";

/** Where a question's typed answer goes: the field paired with it, and the pick that goes too. */
interface TypedIn {
  /**
   * The editor's own `<id>:other`: its question is never optional, though `formOf` requires
   * neither of its fields, since either answers it.
   */
  readonly editorsOwn: boolean;
  readonly field: string;
  /** Codex requires its question answered: "None of the above", the text in the note. */
  readonly pick?: string;
  /**
   * The form requires the field of options: with no pick that says "see the text", the typed
   * answer is its value too, as for a choice with no paired field.
   */
  readonly required: boolean;
}

/** The field with options a text field carries the typed answer of, by the names agents use. */
const pairedWith = (
  key: string,
  field: Record<string, unknown>,
  fields: Record<string, unknown>
): { readonly base: string; readonly editorsOwn: boolean } | null => {
  if (field.type !== "string" || optionsOf(field) !== null) {
    return null;
  }
  const codex = Predicate.isObject(field._meta) ? field._meta.codex : undefined;
  const candidates: { base: string | undefined; editorsOwn: boolean }[] = [
    {
      base:
        Predicate.isObject(codex) && codex.role === "user_note"
          ? text(codex.questionId)
          : undefined,
      editorsOwn: false,
    },
    { base: suffixed(key, OTHER), editorsOwn: true },
    { base: suffixed(key, "__other"), editorsOwn: false },
    { base: suffixed(key, "_custom"), editorsOwn: false },
    { base: suffixed(key, "_note"), editorsOwn: false },
  ];
  for (const { base, editorsOwn } of candidates) {
    const options = base === undefined ? undefined : fields[base];
    if (
      base !== undefined &&
      base !== key &&
      Predicate.isObject(options) &&
      // Only text and lists of options take typing; a number or a yes or no keeps its note.
      (options.type === "string" || options.type === "array") &&
      optionsOf(
        options.type === "array" && Predicate.isObject(options.items)
          ? options.items
          : options
      ) !== null
    ) {
      return { base, editorsOwn };
    }
  }
  return null;
};

const suffixed = (key: string, suffix: string) =>
  key.endsWith(suffix) ? key.slice(0, -suffix.length) : undefined;

/** Each field with options a form pairs a text field with, and where its typed answer goes. */
const pairsOf = (
  fields: Record<string, unknown>,
  required: ReadonlySet<string>
) => {
  const typedIn = new Map<string, TypedIn>();
  for (const [key, field] of Object.entries(fields)) {
    const paired = Predicate.isObject(field)
      ? pairedWith(key, field, fields)
      : null;
    // A text field the form requires is a question of its own, as T3 Code reads it too.
    if (paired !== null && !required.has(key) && !typedIn.has(paired.base)) {
      typedIn.set(paired.base, {
        editorsOwn: paired.editorsOwn,
        field: key,
        required: required.has(paired.base),
      });
    }
  }
  return typedIn;
};

/** Codex's own way to say "my answer is in the note", which the typed answer itself says. */
const codexOtherOf = (question: Question) =>
  question.options.find(
    (o) => o.id === CODEX_OTHER && o.description === CODEX_OTHER_SAYS
  );

/** The questions a form asks, and how the card's answers go back in its fields. */
export interface FormQuestions {
  /** The answers as the content the form is answered with, each in the field it goes in. */
  readonly contentOf: (answers: Answers) => Record<string, ContentValue>;
  readonly questions: Question[];
}

/**
 * The questions a form asks, or null when it has a field the card cannot draw: such an
 * elicitation is declined rather than half answered.
 */
export const questionsOf = (form: unknown): FormQuestions | null => {
  if (!(Predicate.isObject(form) && Predicate.isObject(form.properties))) {
    return null;
  }
  const fields = form.properties;
  const required = new Set(
    Array.isArray(form.required)
      ? form.required.filter((k) => typeof k === "string")
      : []
  );
  const typedIn = pairsOf(fields, required);
  const pairedFields = new Set([...typedIn.values()].map((t) => t.field));
  const questions: Question[] = [];
  for (const [key, field] of Object.entries(fields)) {
    if (pairedFields.has(key)) {
      continue;
    }
    const typed = typedIn.get(key);
    const question = Predicate.isObject(field)
      ? questionOf(
          key,
          field,
          !(required.has(key) || typed?.editorsOwn === true)
        )
      : null;
    if (question === null) {
      return null;
    }
    const codexOther =
      typed?.editorsOwn === false ? codexOtherOf(question) : undefined;
    if (typed !== undefined && codexOther !== undefined) {
      typedIn.set(key, { ...typed, pick: codexOther.id });
      questions.push({
        ...question,
        options: question.options.filter((o) => o !== codexOther),
      });
    } else {
      questions.push(question);
    }
  }
  return {
    contentOf: (answers) => contentOf(questions, typedIn, answers),
    questions,
  };
};

const first = (answer: Answer) =>
  typeof answer === "string" ? answer : (answer[0] ?? "");

/** One answer as its field's value, typed as the form says. */
const fieldValueOf = (question: Question, answer: Answer): ContentValue => {
  const one = first(answer);
  if (question.value === "boolean") {
    // Words of the user's own go as they are: the agent reads them, as it reads a choice's.
    return one === "true" || one === "false" ? one === "true" : one;
  }
  if (question.value === "number" || question.value === "integer") {
    return Number(one);
  }
  if (question.multiple) {
    return typeof answer === "string" ? [answer] : [...answer];
  }
  return one;
};

/** The card's answers as the content an elicitation is answered with, typed as the form says. */
const contentOf = (
  questions: readonly Question[],
  typedIn: ReadonlyMap<string, TypedIn>,
  answers: Answers
): Record<string, ContentValue> => {
  const content: Record<string, ContentValue> = {};
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer === undefined || answer.length === 0) {
      continue;
    }
    const one = first(answer);
    const paired = typedIn.get(question.id);
    const typed =
      typeof answer === "string" &&
      question.value === undefined &&
      !question.options.some((o) => o.id === one);
    if (typed && paired) {
      // Typed: in the field paired with the question, beside the pick that says so.
      content[paired.field] = answer;
      if (paired.pick !== undefined || paired.required) {
        content[question.id] = fieldValueOf(question, paired.pick ?? answer);
      }
    } else {
      content[question.id] = fieldValueOf(question, answer);
    }
  }
  return content;
};

/** The content an elicitation was answered with, as answers to the questions it asked. */
export const answersOf = (
  questions: readonly Question[],
  content: unknown
): Answers => {
  const values = Predicate.isObject(content) ? content : {};
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
