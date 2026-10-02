import type { Question } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import {
  answersOf,
  answersText,
  contentOf,
  formOf,
  questionsOf,
} from "./elicitation.ts";

const color: Question = {
  allowOther: true,
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
  it("asks for options by their titles, and takes an answer of the user's own beside them", () => {
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
    // Either field answers the first question, so only the second is required.
    expect(form.required).toEqual(["size"]);
  });

  it("draws back the questions it was made from", () => {
    expect(questionsOf(formOf([color, size]))).toEqual([color, size]);
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
    });
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
    const questions = questionsOf({
      properties: {
        count: { type: "number" },
        sure: { type: "boolean" },
        tags: { items: { enum: ["a", "b"] }, type: "array" },
      },
      type: "object",
    });
    expect(
      contentOf(questions ?? [], { count: "2.5", sure: "false", tags: ["b"] })
    ).toEqual({ count: 2.5, sure: false, tags: ["b"] });
  });

  it("puts an answer of the user's own in its field, and reads it back first", () => {
    const content = contentOf([color, size], { color: "teal", size: "l" });
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
