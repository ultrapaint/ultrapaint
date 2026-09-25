import { describe, expect, it } from "@effect/vitest";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { recapOf } from "./services/threads/recap.ts";

const user = (
  id: string,
  text: string,
  attachments: readonly string[] = []
): ThreadItem => ({ at: 0, attachments, id, kind: "user", text });
const agent = (id: string, text: string): ThreadItem => ({
  at: 0,
  id,
  kind: "agent",
  text,
});

describe("recapOf", () => {
  it("says nothing when nothing was asked", () => {
    expect(recapOf([])).toBeNull();
    expect(
      recapOf([{ at: 0, id: "s", kind: "status", text: "Switched to Codex" }])
    ).toBeNull();
  });

  it("keeps what was said and what changed, oldest first, without the tool calls", () => {
    const recap = recapOf([
      user("u1", "make it blue", ["designs/home.page.json"]),
      { at: 0, id: "t", kind: "thought", text: "thinking" },
      agent("a1", "Done."),
      {
        at: 0,
        changedFiles: ["designs/home.page.json"],
        id: "e",
        kind: "turn_end",
        stopReason: "end_turn",
      },
      { at: 0, id: "s", kind: "status", text: "Switched to Codex" },
    ]);
    expect(recap).toContain(
      "User: make it blue\n(attached: designs/home.page.json)\n\nAssistant: Done.\n\n(files changed: designs/home.page.json)\n\n(Switched to Codex)"
    );
    expect(recap).not.toContain("thinking");
    expect(recap?.startsWith("<ultrapaint-history>")).toBe(true);
  });

  it("leaves out the oldest entries past its size", () => {
    const long = "x".repeat(3000);
    const items = Array.from({ length: 20 }, (_, i) =>
      user(`u${i}`, `${i} ${long}`)
    );
    const recap = recapOf(items) ?? "";
    expect(recap).toContain("earlier entries left out");
    expect(recap).toContain("User: 19 ");
    expect(recap).not.toContain("User: 0 ");
  });
});
