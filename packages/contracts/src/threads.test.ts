import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ConfigOption,
  defaultChoice,
  namedChoices,
  PromptAttachment,
  startingMode,
  summarise,
  TEXT_ATTACHMENT_LIMIT,
  withNamedChoices,
} from "./threads.ts";

const claudeModels: ConfigOption = {
  category: "model",
  currentValue: "default",
  id: "model",
  name: "Model",
  options: [
    { name: "Default (recommended)", value: "default" },
    { name: "Opus 5.5", value: "opus[1m]" },
    { name: "Sonnet 5", value: "sonnet" },
  ],
};

const effort: ConfigOption = {
  category: "thought_level",
  currentValue: "default",
  id: "effort",
  name: "Effort",
  options: [
    { name: "Default", value: "default" },
    { name: "Low", value: "low" },
    { name: "Medium", value: "medium" },
    { name: "High", value: "high" },
  ],
};

const fast: ConfigOption = {
  category: "model_config",
  currentValue: "off",
  id: "fast",
  name: "Fast mode",
  options: [
    { name: "On", value: "on" },
    { name: "Off", value: "off" },
  ],
};

describe("withNamedChoices", () => {
  it("replaces the agent's unnamed defaults with the choices they stand for", () => {
    const [model, level, other] = withNamedChoices([
      claudeModels,
      effort,
      fast,
    ]);
    expect(model?.currentValue).toBe("opus[1m]");
    expect(level?.currentValue).toBe("medium");
    expect(other).toBe(fast);
  });

  it("keeps a choice that is already named", () => {
    const chosen = { ...claudeModels, currentValue: "sonnet" };
    expect(withNamedChoices([chosen])[0]?.currentValue).toBe("sonnet");
  });

  it("lists the choices without the unnamed default", () => {
    expect(namedChoices(claudeModels).map((c) => c.value)).toEqual([
      "opus[1m]",
      "sonnet",
    ]);
  });

  it("names a default only where the agent offers an unnamed one", () => {
    expect(defaultChoice(effort)).toBe("medium");
    const codexEffort = { ...effort, options: effort.options.slice(1) };
    expect(defaultChoice(codexEffort)).toBeUndefined();
  });
});

describe("startingMode", () => {
  it("starts in the agent's automatic mode", () => {
    expect(
      startingMode(
        [
          { id: "default", name: "Manual" },
          { id: "auto", name: "Auto" },
        ],
        "default"
      )
    ).toBe("auto");
    expect(
      startingMode(
        [
          { id: "read-only", name: "Read-only" },
          { id: "agent", name: "Auto review" },
        ],
        "read-only"
      )
    ).toBe("agent");
  });

  it("keeps the agent's own mode when it has no automatic one", () => {
    expect(startingMode([{ id: "plan", name: "Plan" }], "plan")).toBe("plan");
  });
});

describe("summarise", () => {
  const at = 0;
  it("is the last thing said, on one line and without markdown", () => {
    expect(
      summarise([
        { at, attachments: [], id: "1", kind: "user", text: "Reorder it" },
        { at, id: "2", kind: "agent", text: "**Done.** The table\nnow reads" },
      ])
    ).toEqual({ text: "Done. The table", waiting: false });
  });

  it("waits on the user while a question is unanswered", () => {
    expect(
      summarise([
        { at, id: "1", kind: "agent", text: "One thing first" },
        {
          answers: null,
          at,
          id: "2",
          kind: "question",
          questions: [{ id: "q", options: [], question: "Which alarm types?" }],
        },
      ])
    ).toEqual({ text: "Which alarm types?", waiting: true });
  });
});

describe("a text file attached to a prompt", () => {
  const decodes = (text: string) =>
    Schema.is(PromptAttachment)({ kind: "text", name: "notes.md", text });

  it("holds up to the limit, and no more", () => {
    expect(decodes("x".repeat(TEXT_ATTACHMENT_LIMIT))).toBe(true);
    expect(decodes("x".repeat(TEXT_ATTACHMENT_LIMIT + 1))).toBe(false);
  });
});
