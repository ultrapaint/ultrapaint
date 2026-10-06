import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { tickedAfterCommit } from "./changes.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("tickedAfterCommit", () => {
  it("unticks only the committed files, keeping one ticked while the commit went", () => {
    const ticked = new Set(["a.ts", "b.ts", "c.ts"]);
    expect(tickedAfterCommit(ticked, ["a.ts", "b.ts"])).toEqual(
      new Set(["c.ts"])
    );
    // What it was given is left as it was.
    expect(ticked.size).toBe(3);
  });
});
