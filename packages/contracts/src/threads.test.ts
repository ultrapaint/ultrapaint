import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ConfigOption,
  defaultChoice,
  isPersonaOption,
  namedChoices,
  PromptAttachment,
  startingMode,
  summarise,
  TEXT_ATTACHMENT_LIMIT,
  type ThreadItem,
  waitsForAnswers,
  withChunk,
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

describe("isPersonaOption", () => {
  const persona: ConfigOption = {
    currentValue: "default",
    id: "agent",
    name: "Agent",
    options: [
      { name: "Default", value: "default" },
      { name: "web-fetch", value: "web-fetch" },
    ],
  };

  it("is Claude Code's main-thread agent, and no other agent's option of that id", () => {
    expect(isPersonaOption("claude-code", persona)).toBe(true);
    expect(isPersonaOption("claude-code", claudeModels)).toBe(false);
    expect(isPersonaOption("codex", persona)).toBe(false);
  });
});

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
    ).toEqual({ since: 0, text: "Done. The table", waiting: false });
  });

  it("begins the turn at the person's last prompt, not at a review's findings sent on", () => {
    expect(
      summarise([
        { at: 10, attachments: [], id: "1", kind: "user", text: "Reorder it" },
        { at: 20, id: "2", kind: "agent", text: "Done." },
        {
          at: 30,
          attachments: [],
          id: "3",
          kind: "user",
          review: "r1",
          text: "Findings",
        },
      ]).since
    ).toBe(10);
    expect(
      summarise([{ at: 20, id: "2", kind: "agent", text: "Hello" }])
    ).not.toHaveProperty("since");
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

  it.each(["declined", "cancelled"] as const)(
    "no longer waits once a question is %s",
    (outcome) => {
      expect(
        summarise([
          { at, id: "1", kind: "agent", text: "One thing first" },
          {
            answers: null,
            at,
            id: "2",
            kind: "question",
            outcome,
            questions: [
              { id: "q", options: [], question: "Which alarm types?" },
            ],
          },
        ])
      ).toEqual({ text: "One thing first", waiting: false });
    }
  );
});

describe("waitsForAnswers", () => {
  const at = 0;
  const prompt = (id: string, review?: string): ThreadItem => ({
    at,
    attachments: [],
    id,
    kind: "user",
    text: "A calm settings page",
    ...(review !== undefined && { review }),
  });
  const card = (
    id: string,
    settled: Partial<Extract<ThreadItem, { kind: "question" }>> = {}
  ): ThreadItem => ({
    answers: null,
    at,
    id,
    kind: "question",
    questions: [{ id: "q", options: [], question: "Keep the sidebar?" }],
    ...settled,
  });
  const end: ThreadItem = {
    at,
    changedFiles: [],
    id: "end",
    kind: "turn_end",
    stopReason: "end_turn",
  };

  it("holds while the turn just ended left a question of its own unanswered", () => {
    expect(waitsForAnswers([prompt("1"), card("2"), end])).toBe(true);
    // Its prompt a round's findings: the question is still that turn's.
    expect(
      waitsForAnswers([prompt("1"), prompt("2", "r1"), card("3"), end])
    ).toBe(true);
  });

  it("does not while the turn goes on", () => {
    expect(waitsForAnswers([prompt("1"), card("2")])).toBe(false);
  });

  it.each([
    ["answered", { answers: { q: "yes" } }],
    ["declined", { outcome: "declined" }],
    ["withdrawn", { outcome: "cancelled" }],
  ] as const)("does not once the question is %s", (_, settled) => {
    expect(waitsForAnswers([prompt("1"), card("2", settled), end])).toBe(false);
  });

  it("does not once the person steers instead of answering, but does for a question after the steer", () => {
    const steer: ThreadItem = {
      at,
      attachments: [],
      id: "s",
      kind: "user",
      steer: true,
      text: "Make the header bolder",
    };
    expect(waitsForAnswers([prompt("1"), card("2"), steer, end])).toBe(false);
    expect(waitsForAnswers([prompt("1"), steer, card("2"), end])).toBe(true);
  });

  it("does not for a question an earlier turn left, the person having prompted since", () => {
    expect(
      waitsForAnswers([prompt("1"), card("2"), end, prompt("3"), end])
    ).toBe(false);
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

describe("withChunk", () => {
  it("puts a chunk that starts where the text ends at its end", () => {
    expect(withChunk("Hello ", { offset: 6, text: "world" })).toBe(
      "Hello world"
    );
    expect(withChunk("", { offset: 0, text: "Hello" })).toBe("Hello");
  });

  it("leaves the text as it is for a chunk it already holds", () => {
    expect(withChunk("Hello world", { offset: 6, text: "world" })).toBe(
      "Hello world"
    );
    expect(withChunk("Hello world!", { offset: 6, text: "wor" })).toBe(
      "Hello world!"
    );
  });

  it("takes only what a chunk says past the end of the text", () => {
    expect(withChunk("Hello wor", { offset: 6, text: "world" })).toBe(
      "Hello world"
    );
  });

  it("takes nothing of a chunk that starts past the end of the text", () => {
    expect(withChunk("Hello ", { offset: 9, text: "ld" })).toBeNull();
  });

  it("gives the reply whichever chunks a read of it already held", () => {
    const chunks = [
      { offset: 0, text: "Hello " },
      { offset: 6, text: "wor" },
      { offset: 9, text: "ld" },
      { offset: 11, text: "!" },
    ];
    for (const read of ["", "Hello ", "Hello wor", "Hello world!"]) {
      expect(
        chunks.reduce((held, chunk) => withChunk(held, chunk) ?? held, read)
      ).toBe("Hello world!");
    }
  });
});
