import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import {
  commitBlocked,
  groupTicked,
  sharedFolder,
  statusWord,
  tickedAfterCommit,
} from "./changes.tsx";

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

describe("a group's select-all", () => {
  it("is ticked with all its files, mixed with some, empty with none", () => {
    const paths = ["a.ts", "b.ts"];
    expect(groupTicked(paths, new Set(["a.ts", "b.ts", "c.ts"]))).toBe("all");
    expect(groupTicked(paths, new Set(["b.ts"]))).toBe("some");
    expect(groupTicked(paths, new Set(["c.ts"]))).toBe("none");
  });
});

describe("why Commit can't be pressed", () => {
  it("asks for ticked files first, then a message, and is nothing once both are there", () => {
    expect(commitBlocked(0, "Header pass")).toBe("Tick the files to commit");
    expect(commitBlocked(2, "  ")).toBe("Write a message to commit 2 files");
    expect(commitBlocked(1, "")).toBe("Write a message to commit 1 file");
    expect(commitBlocked(1, "Header pass")).toBeNull();
  });
});

describe("the folder a group's rows leave off", () => {
  it("is the folder all its files share", () => {
    expect(
      sharedFolder([
        "docs/designs/redesign/canvas.json",
        "docs/designs/redesign/pages/home.json",
      ])
    ).toBe("docs/designs/redesign");
  });

  it("is nothing for files in different places, or for a lone file", () => {
    expect(sharedFolder(["apps/a.ts", "docs/b.md"])).toBe("");
    expect(sharedFolder(["docs/designs/redesign/canvas.json"])).toBe("");
  });

  it("stops at a whole folder's name, never inside one", () => {
    expect(sharedFolder(["docs/design/a.json", "docs/designs/b.json"])).toBe(
      "docs"
    );
  });
});

describe("a file's status in a word", () => {
  it("names new, deleted, renamed and conflicting files, and says nothing of a modified one", () => {
    expect(statusWord("??")).toBe("New");
    expect(statusWord("A ")).toBe("New");
    expect(statusWord(" D")).toBe("Deleted");
    expect(statusWord("R ")).toBe("Renamed");
    expect(statusWord("UU")).toBe("Conflict");
    expect(statusWord(" M")).toBeNull();
    expect(statusWord("MM")).toBeNull();
  });
});
