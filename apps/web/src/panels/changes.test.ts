import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import {
  changedSince,
  commitBlocked,
  diffLines,
  gitSaid,
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

describe("what Commit, pressed too soon, says is missing", () => {
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

describe("what a diff since a point says above its files", () => {
  it("counts the design files changed since the snapshot or checkpoint, or says none did", () => {
    expect(changedSince(3, "snapshot")).toBe(
      "3 design files changed since this snapshot."
    );
    expect(changedSince(1, "checkpoint")).toBe(
      "1 design file changed since this checkpoint."
    );
    expect(changedSince(0, "snapshot")).toBe(
      "No design file has changed since this snapshot."
    );
  });
});

describe("what git said when a command failed", () => {
  it("is git's own words, without the command and its exit code before them", () => {
    expect(
      gitSaid(
        "git commit exited 128: Author identity unknown\n*** Please tell me who you are."
      )
    ).toBe("Author identity unknown\n*** Please tell me who you are.");
    expect(gitSaid("Writing to git is off")).toBe("Writing to git is off");
  });
});

describe("a diff's lines", () => {
  const drawn = (diff: string) =>
    diffLines(diff).map((line) => `${line.kind}|${line.text}`);

  it("are changes by their first character, whatever the line itself starts with", () => {
    // A snapshot's or a checkpoint's diff: the two lines that name the file, then its lines.
    const diff = [
      "--- a/notes.md",
      "+++ b/notes.md",
      " Title",
      "----",
      "--- a/quoted",
      "+++i;",
      "+++ b/quoted",
      "",
    ].join("\n");
    expect(drawn(diff)).toEqual([
      "context|--- a/notes.md",
      "context|+++ b/notes.md",
      "context| Title",
      "removed|----",
      "removed|--- a/quoted",
      "added|+++i;",
      "added|+++ b/quoted",
    ]);
  });

  it("names each file of git's diff before its own changes", () => {
    const diff = [
      "diff --git a/one.md b/one.md",
      "index bdad409..422c2b7 100644",
      "--- a/one.md",
      "+++ b/one.md",
      "@@ -1,3 +1,2 @@",
      " a",
      "----",
      "\\ No newline at end of file",
      "diff --git a/two.c b/two.c",
      "index c4f6559..c080028 100644",
      "--- a/two.c",
      "+++ b/two.c",
      "@@ -1,2 +1,3 @@",
      " ++i;",
      "+++j;",
      "",
    ].join("\n");
    expect(
      diffLines(diff)
        .filter((line) => line.kind !== "context")
        .map((line) => `${line.kind}|${line.text}`)
    ).toEqual(["removed|----", "added|+++j;"]);
  });
});
