import type { Thread } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import { groupChats } from "./chat-groups.ts";

// Local noon, so the day the tests say is today in any time zone.
const NOW = new Date(2026, 10, 24, 12).getTime();
const DAY = 24 * 60 * 60_000;

const chat = (id: string, extra: Partial<Thread> = {}): Thread => ({
  agentId: "claude-code",
  createdAt: NOW - 2 * DAY,
  id,
  status: "idle",
  summary: { since: NOW - DAY, text: "", waiting: false },
  title: id,
  updatedAt: NOW - 60_000,
  ...extra,
});

const asking = chat("asking", {
  status: "running",
  summary: { since: NOW, text: "", waiting: true },
});
const working = chat("working", { status: "running" });
const reviewing = chat("reviewing", { status: "reviewing" });
const done = chat("done");
const old = chat("old", { updatedAt: NOW - 3 * DAY });
const settled = chat("settled", { settledAt: NOW - 1000 });
const all = [asking, working, reviewing, done, old, settled];

/** Each group as its label and the ids it holds, in order. */
const shape = (groups: ReturnType<typeof groupChats>) =>
  groups.map((g) => [g.label, g.threads.map((t) => t.id)]);

const options = {
  now: NOW,
  pageOf: (t: Thread) => (t.id === "done" ? "/pricing" : null),
  unread: () => false,
};

describe("groupChats", () => {
  it("by state, puts what needs the person or finished first, then Working, then Settled", () => {
    expect(shape(groupChats(all, { ...options, grouping: "state" }))).toEqual([
      [null, ["asking", "done", "old"]],
      ["Working", ["working", "reviewing"]],
      ["Settled", ["settled"]],
    ]);
  });

  it("by day, says Today and Earlier, Settled last", () => {
    expect(shape(groupChats(all, { ...options, grouping: "day" }))).toEqual([
      ["Today", ["asking", "working", "reviewing", "done"]],
      ["Earlier", ["old"]],
      ["Settled", ["settled"]],
    ]);
  });

  it("by page, puts each chat under its page and the rest under No page, Settled last", () => {
    expect(shape(groupChats(all, { ...options, grouping: "page" }))).toEqual([
      ["/pricing", ["done"]],
      ["No page", ["asking", "working", "reviewing", "old"]],
      ["Settled", ["settled"]],
    ]);
  });

  it("with none, lists every chat newest first, Settled last", () => {
    expect(shape(groupChats(all, { ...options, grouping: "none" }))).toEqual([
      [null, ["asking", "working", "reviewing", "done", "old"]],
      ["Settled", ["settled"]],
    ]);
  });

  it("leaves out a group with no chat, and marks the groups that fold", () => {
    const groups = groupChats([working, settled], {
      ...options,
      grouping: "state",
    });
    expect(groups.map((g) => [g.key, g.folds])).toEqual([
      ["working", true],
      ["settled", true],
    ]);
  });
});
