import type { Thread } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import { rowState, someBusy, threadView } from "./thread-view.ts";

const thread = (
  status: Thread["status"],
  waiting?: boolean,
  id = "thread_1"
): Thread => ({
  agentId: "fake",
  createdAt: 0,
  id,
  status,
  title: "A thread",
  updatedAt: 0,
  ...(waiting === undefined ? {} : { summary: { text: "", waiting } }),
});

describe("threadView", () => {
  it.each([
    ["idle", undefined, false, false, false, null, null],
    ["idle", true, false, true, false, "Your turn", "attention"],
    ["running", undefined, true, false, false, "Working", "working"],
    ["running", true, true, true, false, "Your turn", "attention"],
    ["cancelling", undefined, true, false, false, "Working", "working"],
    [
      "unresponsive",
      undefined,
      true,
      false,
      false,
      "Not responding",
      "attention",
    ],
    ["unresponsive", true, true, true, false, "Your turn", "attention"],
    ["reviewing", undefined, true, false, false, "Reviewing", "working"],
    ["error", undefined, false, false, true, "Stopped", "failed"],
    ["error", true, false, true, true, "Your turn", "attention"],
  ] as const)(
    "%s, waiting %s: busy %s, waiting %s, failed %s, %s in %s",
    (status, waiting, busy, asks, failed, label, tone) => {
      expect(threadView(thread(status, waiting))).toEqual({
        busy,
        failed,
        label,
        tone,
        unresponsive: status === "unresponsive",
        waiting: asks,
      });
    }
  );

  it("shows a thread not there as idle", () => {
    expect(threadView(undefined)).toEqual(threadView(thread("idle")));
  });
});

describe("someBusy", () => {
  it("says an agent is working while a thread is being stopped", () => {
    expect(
      someBusy([thread("idle"), thread("cancelling", undefined, "t2")])
    ).toBe(true);
  });

  it("says nothing of threads at rest", () => {
    expect(someBusy([thread("idle"), thread("error", true, "t2")])).toBe(false);
  });
});

describe("rowState", () => {
  const at = (
    status: Thread["status"],
    summary?: { since?: number; waiting?: boolean }
  ) => ({
    status,
    ...(summary && {
      summary: { text: "", waiting: summary.waiting ?? false, ...summary },
    }),
  });

  it.each([
    [
      "a question, the turn under way",
      at("running", { since: 5, waiting: true }),
      false,
      "asks",
    ],
    [
      "a question after the turn",
      at("idle", { since: 5, waiting: true }),
      false,
      "asks",
    ],
    ["a stop ignored", at("unresponsive", { since: 5 }), false, "unresponsive"],
    [
      "the turn under way, unread",
      at("running", { since: 5 }),
      true,
      "working",
    ],
    ["a review round", at("reviewing", { since: 5 }), false, "working"],
    ["a failure not opened", at("error", { since: 5 }), true, "stopped"],
    ["a failure opened", at("error", { since: 5 }), false, null],
    ["a turn finished, not opened", at("idle", { since: 5 }), true, "done"],
    ["a turn finished, opened", at("idle", { since: 5 }), false, null],
    ["nothing sent yet", at("idle"), true, null],
  ] as const)("%s", (_name, given, unread, kind) => {
    expect(rowState(given, unread)?.kind ?? null).toBe(kind);
  });

  it("says a review as Reviewing, timed from the person's prompt", () => {
    expect(rowState(at("reviewing", { since: 5 }), false)).toEqual({
      kind: "working",
      label: "Reviewing",
      since: 5,
    });
  });
});
