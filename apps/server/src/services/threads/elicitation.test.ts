import type { Question } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import { answersOf, answersText, formOf, questionsOf } from "./elicitation.ts";

const color: Question = {
  id: "color",
  options: [
    { description: "warm", id: "red", label: "Red" },
    { id: "blue", label: "Blue" },
  ],
  question: "Which color?",
};
const size: Question = {
  id: "size",
  options: [
    { id: "s", label: "Small" },
    { id: "l", label: "Large" },
  ],
  question: "Which size?",
};

describe("questions as an elicitation form", () => {
  it("asks for options by their titles, and takes an answer of the user's own beside every question's", () => {
    const form = formOf([color, size]);
    expect(form.properties.color).toEqual({
      oneOf: [
        { const: "red", description: "warm", title: "Red" },
        { const: "blue", title: "Blue" },
      ],
      title: "Which color?",
      type: "string",
    });
    expect(form.properties["color:other"]).toMatchObject({ type: "string" });
    expect(form.properties["size:other"]).toMatchObject({ type: "string" });
    // Either field of a question answers it, so neither is required on its own.
    expect(form.required).toEqual([]);
  });

  it("draws back the questions it was made from", () => {
    expect(questionsOf(formOf([color, size]))?.questions).toEqual([
      color,
      size,
    ]);
  });

  it("draws the fields any MCP server may ask with", () => {
    const questions = questionsOf({
      properties: {
        count: { title: "How many?", type: "integer" },
        name: { description: "As on the card", type: "string" },
        sure: { title: "Sure?", type: "boolean" },
        tags: {
          items: { enum: ["a", "b"] },
          title: "Tags",
          type: "array",
        },
      },
      required: ["count", "sure"],
      type: "object",
    })?.questions;
    expect(questions).toEqual([
      { id: "count", options: [], question: "How many?", value: "integer" },
      {
        description: "As on the card",
        id: "name",
        optional: true,
        options: [],
        question: "name",
      },
      {
        id: "sure",
        options: [
          { id: "true", label: "Yes" },
          { id: "false", label: "No" },
        ],
        question: "Sure?",
        value: "boolean",
      },
      {
        id: "tags",
        multiple: true,
        optional: true,
        options: [
          { id: "a", label: "a" },
          { id: "b", label: "b" },
        ],
        question: "Tags",
      },
    ]);
  });

  it("will not draw a field it has no input for", () => {
    expect(
      questionsOf({ properties: { where: { type: "object" } }, type: "object" })
    ).toBeNull();
    expect(questionsOf("not a form")).toBeNull();
  });
});

describe("answers and the content they are sent as", () => {
  it("types each answer as its field says", () => {
    const form = questionsOf({
      properties: {
        count: { type: "number" },
        sure: { type: "boolean" },
        tags: { items: { enum: ["a", "b"] }, type: "array" },
      },
      type: "object",
    });
    expect(
      form?.contentOf({ count: "2.5", sure: "false", tags: ["b"] })
    ).toEqual({ count: 2.5, sure: false, tags: ["b"] });
  });

  it("puts an answer of the user's own in its field, and reads it back first", () => {
    const content = questionsOf(formOf([color, size]))?.contentOf({
      color: "teal",
      size: "l",
    });
    expect(content).toEqual({ "color:other": "teal", size: "l" });
    expect(answersOf([color, size], content)).toEqual({
      color: "teal",
      size: "l",
    });
  });

  it("reads to the agent as one line per question", () => {
    expect(answersText([color, size], { color: "red" })).toBe(
      [
        "Answers to your questions:",
        "1. Which color? — Red [red]",
        "2. Which size? — (no answer)",
      ].join("\n")
    );
  });
});

/**
 * The forms each agent asks its own question tool with, as its ACP adapter builds them: every
 * question is one question on the card, and takes typing (ADR 0140).
 */
describe("an agent's own question, as its adapter asks it", () => {
  const options = [
    { const: "Add a rule", description: "A 2px rule", title: "Add a rule" },
    { const: "Leave as is", title: "Leave as is" },
  ];

  // Claude's AskUserQuestion through claude-agent-acp 0.95: each question `question_<n>`, its
  // own answer in `question_<n>_custom`, nothing required.
  const claude = {
    properties: {
      question_0: { oneOf: options, title: "Navbar gap", type: "string" },
      question_0_custom: {
        description:
          "Type your own answer, or add a note to the option you chose above (optional).",
        title: "Other",
        type: "string",
      },
    },
    type: "object",
  };

  it("asks Claude's question once, taking typing, with no Other question beside it", () => {
    const form = questionsOf(claude);
    expect(form?.questions).toHaveLength(1);
    expect(form?.questions[0]).toMatchObject({
      id: "question_0",
      question: "Navbar gap",
    });
    expect(form?.questions[0]?.allowOther).not.toBe(false);
  });

  it("sends Claude's typed answer in its Other field, and a pick as itself", () => {
    const form = questionsOf(claude);
    expect(form?.contentOf({ question_0: "8px of space" })).toEqual({
      question_0_custom: "8px of space",
    });
    expect(form?.contentOf({ question_0: "Add a rule" })).toEqual({
      question_0: "Add a rule",
    });
  });

  // Codex's request_user_input through codex-acp 2.2: a "None of the above" option it adds, and
  // the typed answer in `<id>_note`, marked by its `_meta`; the question is required.
  const codex = {
    properties: {
      gap: {
        _meta: { codex: { isOther: true, isSecret: false } },
        oneOf: [
          ...options,
          {
            const: "None of the above",
            description: "Provide a different answer in the note field.",
            title: "None of the above",
          },
        ],
        title: "Navbar gap",
        type: "string",
      },
      gap_note: {
        _meta: {
          codex: { isSecret: false, questionId: "gap", role: "user_note" },
        },
        title: "Additional answer or note",
        type: "string",
      },
    },
    required: ["gap"],
    type: "object",
  };

  it("asks Codex's question once, without the option that only points at the note", () => {
    const form = questionsOf(codex);
    expect(form?.questions).toHaveLength(1);
    expect(form?.questions[0]?.options.map((o) => o.id)).toEqual([
      "Add a rule",
      "Leave as is",
    ]);
    expect(form?.questions[0]?.allowOther).not.toBe(false);
  });

  it("sends Codex's typed answer as None of the above with the note, as its own client does", () => {
    const form = questionsOf(codex);
    expect(form?.contentOf({ gap: "8px of space" })).toEqual({
      gap: "None of the above",
      gap_note: "8px of space",
    });
    expect(form?.contentOf({ gap: "Leave as is" })).toEqual({
      gap: "Leave as is",
    });
  });

  it("takes typing on a yes or no too, sent as the words typed", () => {
    const form = questionsOf({
      properties: { sure: { title: "Sure?", type: "boolean" } },
      type: "object",
    });
    expect(form?.questions[0]?.allowOther).not.toBe(false);
    expect(form?.contentOf({ sure: "only on mobile" })).toEqual({
      sure: "only on mobile",
    });
    expect(form?.contentOf({ sure: "true" })).toEqual({ sure: true });
  });

  it("pairs a note by its name alone, without Codex's mark", () => {
    const form = questionsOf({
      properties: {
        gap: { oneOf: options, title: "Navbar gap", type: "string" },
        gap_note: { title: "Note", type: "string" },
      },
      type: "object",
    });
    expect(form?.questions.map((q) => q.id)).toEqual(["gap"]);
    expect(form?.contentOf({ gap: "8px of space" })).toEqual({
      gap_note: "8px of space",
    });
  });

  it("fills a required choice with the typed answer too, where no option says to read the text", () => {
    const form = questionsOf({
      properties: {
        gap: { oneOf: options, title: "Navbar gap", type: "string" },
        gap__other: { title: "Other", type: "string" },
      },
      required: ["gap"],
      type: "object",
    });
    expect(form?.questions.map((q) => q.id)).toEqual(["gap"]);
    expect(form?.contentOf({ gap: "8px of space" })).toEqual({
      gap: "8px of space",
      gap__other: "8px of space",
    });
  });

  it("keeps a text field the form requires as a question of its own", () => {
    const form = questionsOf({
      properties: {
        gap: { oneOf: options, title: "Navbar gap", type: "string" },
        gap_note: { title: "Why?", type: "string" },
      },
      required: ["gap_note"],
      type: "object",
    });
    expect(form?.questions.map((q) => q.id)).toEqual(["gap", "gap_note"]);
  });

  it("keeps a note beside a number as a question of its own, since a number takes no words", () => {
    const form = questionsOf({
      properties: {
        count: { enum: [1, 2], title: "How many?", type: "integer" },
        count_note: { title: "Note", type: "string" },
      },
      type: "object",
    });
    expect(form?.questions.map((q) => q.id)).toEqual(["count", "count_note"]);
  });

  it("takes typing on a choice with no field for it, sent as the choice's value", () => {
    const form = questionsOf({
      properties: {
        gap: { oneOf: options, title: "Navbar gap", type: "string" },
      },
      required: ["gap"],
      type: "object",
    });
    expect(form?.questions[0]?.allowOther).not.toBe(false);
    expect(form?.contentOf({ gap: "8px of space" })).toEqual({
      gap: "8px of space",
    });
  });
});
