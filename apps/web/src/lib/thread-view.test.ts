import type { Thread } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import { someBusy, threadView } from "./thread-view.ts";

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
    ["running", true, true, true, false, "Working", "working"],
    ["cancelling", undefined, true, false, false, "Working", "working"],
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
