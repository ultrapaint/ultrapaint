import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  groupWork,
  hasOpenCall,
  stopNote,
  workSummary,
} from "./thread-work.ts";

const tool = (
  id: string,
  toolKind: string | undefined,
  status: "completed" | "failed" | "in_progress" = "completed",
  title = "Read file"
): ThreadItem => ({
  at: 0,
  content: [],
  id,
  kind: "tool",
  locations: [],
  status,
  title,
  toolCallId: id,
  ...(toolKind ? { toolKind } : {}),
});

const text = (
  id: string,
  kind: "agent" | "thought" | "user",
  at = 0
): ThreadItem =>
  kind === "user"
    ? { at, attachments: [], id, kind, text: id }
    : { at, id, kind, text: id };

const turnEnd = (id: string, at = 0): ThreadItem => ({
  at,
  changedFiles: [],
  id,
  kind: "turn_end",
  stopReason: "end_turn",
});

const shape = (items: readonly ThreadItem[]) =>
  groupWork(items).map((entry) =>
    entry.kind === "work" ? entry.items.map((i) => i.id) : entry.item.id
  );

describe("groupWork", () => {
  it("folds each run of tool calls and thoughts between two messages", () => {
    const items = [
      text("ask", "user"),
      text("t1", "thought"),
      tool("a", "read"),
      tool("b", "search"),
      text("answer", "agent"),
      tool("c", "edit"),
      tool("d", "edit"),
    ];
    expect(shape(items)).toEqual([
      "ask",
      ["t1", "a", "b"],
      "answer",
      ["c", "d"],
    ]);
  });

  it("leaves a lone tool call and a run of only thinking as they are", () => {
    const items = [
      tool("a", "read"),
      text("answer", "agent"),
      text("t1", "thought"),
      text("t2", "thought"),
    ];
    expect(shape(items)).toEqual(["a", "answer", "t1", "t2"]);
  });

  it("keys a run by its first item, so it stays the same entry as it grows", () => {
    const [entry] = groupWork([tool("a", "read"), tool("b", "read")]);
    expect(entry?.kind === "work" && entry.id).toBe("a");
  });

  it("gives the end of a turn the time of the prompt that started it", () => {
    const entries = groupWork([
      text("ask", "user", 1000),
      tool("a", "read"),
      turnEnd("end", 5000),
      turnEnd("orphan", 9000),
    ]);
    expect(entries.map((e) => (e.kind === "turn" ? e.since : e.kind))).toEqual([
      "item",
      "item",
      1000,
      undefined,
    ]);
  });
});

describe("formatDuration", () => {
  it("says seconds, then minutes and seconds", () => {
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(64_000)).toBe("1m 4s");
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("stopNote", () => {
  it("says nothing when the agent finished on its own", () => {
    expect(stopNote("end_turn")).toBeNull();
  });

  it("says why otherwise, even for a reason it does not know", () => {
    expect(stopNote("cancelled")).toBe("Stopped");
    expect(stopNote("overheated")).toBe("Stopped: overheated");
  });
});

describe("workSummary", () => {
  const items = [
    tool("a", "read"),
    tool("b", "search"),
    tool("c", "read"),
    tool("d", "execute", "failed"),
    tool("e", "other", "completed", "mcp__ultrapaint__list_pages"),
    text("t", "thought"),
  ];

  it("counts each kind once, in the order the agent first did it", () => {
    expect(workSummary(items, false)).toEqual({
      failed: 1,
      text: "Read ×2, Searched, Ran, Inspected",
    });
  });

  it("speaks in the present while the agent is still at it", () => {
    expect(workSummary(items, true).text).toBe(
      "Reading ×2, Searching, Running, Inspecting"
    );
  });
});

describe("hasOpenCall", () => {
  it("is true while a tool call has not finished", () => {
    expect(hasOpenCall([tool("a", "read")])).toBe(false);
    expect(hasOpenCall([tool("a", "read", "in_progress")])).toBe(true);
  });
});
