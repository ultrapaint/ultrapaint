import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import {
  endLine,
  isRunPlan,
  type ReviewItem,
  roundsByPlan,
  runSteps,
  stoppedRuns,
} from "./design-run.ts";
import { groupWork } from "./thread-work.ts";

type Status = "pending" | "in_progress" | "completed";

const plan = (
  id: string,
  entries: readonly (readonly [string, Status])[]
): Extract<ThreadItem, { kind: "plan" }> => ({
  at: 0,
  entries: entries.map(([content, status]) => ({ content, status })),
  id,
  kind: "plan",
});

const round = (
  n: number,
  scores: readonly (number | undefined)[],
  end?: ReviewItem["end"]
): ReviewItem => ({
  at: n,
  findings: [],
  id: `r${n}`,
  kind: "review",
  maxRounds: 6,
  reviewers: scores.map((score, i) => ({
    approved: end?.reason === "approved",
    findings: 0,
    key: `m${i}`,
    name: `Model ${i}`,
    ...(score === undefined
      ? { reason: "timed out", status: "no-score" as const }
      : { score, status: "done" as const }),
  })),
  round: n,
  ...(end ? { end } : {}),
});

const user = (id: string, review?: string): ThreadItem => ({
  at: 0,
  attachments: [],
  id,
  kind: "user",
  text: "Design billing settings",
  ...(review ? { review } : {}),
});

describe("the run card", () => {
  const building = plan("p1", [
    ["Outline the page", "completed"],
    ["Build Plan", "completed"],
    ["Build Payment method", "completed"],
    ["Build Invoices", "in_progress"],
    ["Build Invoice emails", "pending"],
  ]);

  it("reads a design thread's plan as Outline, Build and Review", () => {
    expect(isRunPlan(building)).toBe(true);
    expect(isRunPlan(plan("p", [["Read the code", "pending"]]))).toBe(false);
    expect(runSteps(building, [], "Standard · 3 review models")).toEqual([
      { detail: "4 sections", status: "completed", title: "Outline" },
      {
        detail: "3 of 4",
        now: "Invoices",
        status: "in_progress",
        title: "Build",
      },
      {
        detail: "Standard · 3 review models",
        status: "pending",
        title: "Review",
      },
    ]);
  });

  it("follows the review round by round, then says how it ended", () => {
    expect(runSteps(building, [round(2, [84])], "")[2]).toMatchObject({
      detail: "Round 2 of up to 6",
      status: "in_progress",
    });
    const approved = round(3, [90, 94, 92], {
      reason: "approved",
      unmet: [],
    });
    expect(runSteps(building, [approved], "")[2]).toMatchObject({
      detail: "Approved by all 3 · 90–94 · 3 rounds",
      status: "completed",
    });
  });

  it("marks a review that ended without approval as stopped, not done", () => {
    const capped = round(6, [80], { best: 4, reason: "max-rounds", unmet: [] });
    expect(runSteps(building, [capped], "")[2]?.status).toBe("stopped");
    const met = round(2, [92], { reason: "goal", unmet: [] });
    expect(runSteps(building, [met], "")[2]?.status).toBe("completed");
  });

  it("names a capped review's kept round, and why a review couldn't start", () => {
    expect(
      endLine(round(6, [80], { best: 4, reason: "max-rounds", unmet: [] }), 6)
    ).toBe("Stopped after 6 rounds, the most a review runs · round 4 kept");
    expect(
      endLine(
        round(1, [], {
          problem: "Codex isn’t signed in.",
          reason: "failed",
          unmet: [],
        }),
        1
      )
    ).toBe("Review couldn’t start: Codex isn’t signed in.");
  });

  it("gives each plan the rounds of its run, the review's own prompts included", () => {
    const items: ThreadItem[] = [
      user("u1"),
      building,
      round(1, [70]),
      user("u2", "r1"),
      round(2, [91], { reason: "approved", unmet: [] }),
      user("u3"),
      round(1, [undefined]),
    ];
    expect(
      roundsByPlan(items)
        .get("p1")
        ?.map((r) => r.id)
    ).toEqual(["r1", "r2"]);
  });

  it("says where a run the person stopped stopped, until a turn ends on its own", () => {
    const end = (
      id: string,
      stopReason: "cancelled" | "end_turn"
    ): ThreadItem => ({
      at: 0,
      changedFiles: [],
      id,
      kind: "turn_end",
      stopReason,
    });
    const half = plan("p2", [
      ["Build Plan", "completed"],
      ["Build Invoices", "in_progress"],
    ]);
    expect(stoppedRuns([user("u1"), half, end("t1", "cancelled")])).toEqual(
      new Set(["p2"])
    );
    expect(
      stoppedRuns([
        user("u1"),
        half,
        end("t1", "cancelled"),
        end("t2", "end_turn"),
      ])
    ).toEqual(new Set());
    expect(runSteps(half, [], "", true)[0]).toMatchObject({
      detail: "Stopped at 1 of 2",
      now: "Stopped before Invoices. What was built is on the canvas.",
      status: "stopped",
    });
  });

  it("leaves the prompts that carry a round's findings out of the chat", () => {
    const entries = groupWork([user("u1"), round(1, [70]), user("u2", "r1")]);
    expect(entries.map((e) => (e.kind === "work" ? e.id : e.item.id))).toEqual([
      "u1",
      "r1",
    ]);
  });
});
