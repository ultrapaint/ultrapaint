// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { Thread } from "@ultrapaint/contracts/threads";
import { describe, expect, it, vi } from "vitest";
import { newsOf, notificationOf } from "./agent-notifications.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const thread = (
  status: Thread["status"],
  waiting = false
): Pick<Thread, "status" | "summary"> =>
  ({ status, summary: { waiting } }) as Pick<Thread, "status" | "summary">;

describe("what is news to someone away", () => {
  it("an agent that finished, or stopped", () => {
    expect(newsOf({ busy: true, waiting: false }, thread("idle"))).toBe("done");
    expect(newsOf({ busy: true, waiting: false }, thread("error"))).toBe(
      "stopped"
    );
  });

  it("an agent that asks, once", () => {
    expect(newsOf({ busy: true, waiting: false }, thread("idle", true))).toBe(
      "asks"
    );
    expect(newsOf({ busy: false, waiting: true }, thread("idle", true))).toBe(
      null
    );
  });

  it("nothing for a thread still at work, or one never seen working", () => {
    expect(newsOf({ busy: true, waiting: false }, thread("running"))).toBe(
      null
    );
    expect(newsOf(undefined, thread("idle"))).toBe(null);
  });

  it("is told with the chat's title", () => {
    expect(notificationOf("Pricing page", "done")).toEqual({
      body: "The agent finished.",
      title: "Pricing page",
    });
    expect(notificationOf(" ", "asks").title).toBe("A chat");
  });
});
