import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import { nowDoing, splitTurns, stepTitle, turnParts } from "./thread-turns.ts";

type ToolItem = Extract<ThreadItem, { kind: "tool" }>;

const user = (id: string, review?: string): ThreadItem => ({
  at: 0,
  attachments: [],
  id,
  kind: "user",
  text: id,
  ...(review === undefined ? {} : { review }),
});
const agent = (id: string, text = id): ThreadItem => ({
  at: 0,
  id,
  kind: "agent",
  text,
});
const tool = (
  id: string,
  title: string,
  status: ToolItem["status"] = "completed"
): ToolItem => ({
  at: 0,
  content: [],
  id,
  kind: "tool",
  locations: [],
  status,
  title,
  toolCallId: id,
});
const end = (id: string, files: readonly string[]): ThreadItem => ({
  at: 9,
  changedFiles: files,
  id,
  kind: "turn_end",
  stopReason: "end_turn",
});

describe("a chat as turns", () => {
  it("starts a turn at each prompt of the person's, a round's findings staying in theirs", () => {
    const turns = splitTurns([
      user("u1"),
      tool("c1", "Read DESIGN.md"),
      user("findings", "r1"),
      agent("a1"),
      user("u2"),
      agent("a2"),
    ]);
    expect(turns.map((t) => [t.id, t.items.map((i) => i.id)])).toEqual([
      ["u1", ["c1", "findings", "a1"]],
      ["u2", ["a2"]],
    ]);
  });

  it("keeps what came before any prompt as a turn of its own", () => {
    const turns = splitTurns([agent("hello"), user("u1")]);
    expect(turns.map((t) => [t.id, t.prompt?.id])).toEqual([
      ["hello", undefined],
      ["u1", "u1"],
    ]);
  });
});

/** The one turn of `items`. */
const onlyTurn = (items: readonly ThreadItem[]) => {
  const [turn] = splitTurns(items);
  if (!turn) {
    throw new Error("no turn");
  }
  return turn;
};

describe("a turn's parts", () => {
  const turn = onlyTurn([
    user("u1"),
    agent("plan", "I'll keep three plans."),
    tool("c1", "mcp__ultrapaint__apply_operations"),
    end("e1", ["docs/designs/pricing.page.json"]),
    agent("fixes", "Fixed the two findings."),
    tool("c2", "mcp__ultrapaint__apply_operations"),
    agent("done", "Three plans now."),
    end("e2", ["docs/designs/pricing.page.json", "DESIGN.md"]),
  ]);

  it("reads the agent's last message as the answer once the turn is over, the rest as steps", () => {
    const parts = turnParts(turn, true);
    expect(parts.answer?.id).toBe("done");
    expect(parts.steps.map((s) => s.id)).toEqual(["plan", "c1", "fixes", "c2"]);
    expect(parts.changed).toEqual([
      "docs/designs/pricing.page.json",
      "DESIGN.md",
    ]);
  });

  it("has no answer while the agent works: its words are steps", () => {
    const parts = turnParts(turn, false);
    expect(parts.answer).toBeUndefined();
    expect(parts.steps.at(-1)?.id).toBe("done");
  });
});

describe("a step in words", () => {
  it("says what an editor tool does, as it happens and once done", () => {
    expect(stepTitle(tool("c", "mcp__ultrapaint__get_screenshot"), true)).toBe(
      "Taking a screenshot"
    );
    expect(stepTitle(tool("c", "mcp.ultrapaint.read_page"), false)).toBe(
      "Read a page"
    );
  });

  it("names an editor tool it has no words for by its name", () => {
    expect(stepTitle(tool("c", "mcp__ultrapaint__map_values"), false)).toBe(
      "Map values"
    );
  });

  it("keeps the title the agent gave any other tool", () => {
    expect(stepTitle(tool("c", "Read DESIGN.md"), false)).toBe(
      "Read DESIGN.md"
    );
  });

  it("says what the agent is doing now from its last step", () => {
    const turn = onlyTurn([
      user("u1"),
      tool("c1", "mcp__ultrapaint__apply_operations", "in_progress"),
    ]);
    expect(nowDoing(turn)).toBe("Editing a page");
  });

  it("waits for the person while a question of the agent's is open", () => {
    const turn = onlyTurn([
      user("u1"),
      {
        answers: null,
        at: 1,
        id: "q1",
        kind: "question",
        questions: [{ id: "q", options: [], question: "Where?" }],
      },
    ]);
    expect(nowDoing(turn)).toBe("Waiting for your answer");
  });
});
