import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { diffLines } from "./changes.tsx";
import {
  ago,
  changeName,
  commitBlocked,
  commitLabel,
  gitSaid,
  sharedFolder,
  statusWord,
  toCommit,
} from "./changes-git.tsx";
import { dayOf } from "./changes-history.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("what a commit takes", () => {
  it("takes the designs' changes unless unticked, and the other files only once ticked", () => {
    const files = [
      { code: " M", design: true, path: "designs/home.page.json" },
      { code: "??", design: true, path: "designs/pricing.page.json" },
      { code: " M", design: false, path: "src/app.tsx" },
      { code: " M", design: false, path: "notes.txt" },
    ];
    expect(
      toCommit(files, {
        ticked: new Set(["notes.txt"]),
        unticked: new Set(["designs/pricing.page.json"]),
      })
    ).toEqual(["designs/home.page.json", "notes.txt"]);
  });
});

describe("a changed file as the editor names it", () => {
  const pages = [
    {
      canvas: "redesign",
      file: "docs/designs/redesign/home.page.json",
      name: "Home",
    },
  ];
  const canvasName = (id: string) =>
    id === "redesign" ? "Redesign" : undefined;

  it("is a page by its name and canvas, a component by its name, the design system by its file", () => {
    expect(
      changeName("docs/designs/redesign/home.page.json", pages, canvasName)
    ).toEqual({ name: "Home", where: "Redesign" });
    expect(
      changeName(
        "docs/designs/components/Button.component.json",
        pages,
        canvasName
      )
    ).toEqual({ name: "Button", where: "Component" });
    expect(changeName("DESIGN.md", pages, canvasName)).toEqual({
      name: "DESIGN.md",
      where: "Design system",
    });
    expect(
      changeName(
        "docs/designs/redesign/canvas.json",
        pages,
        canvasName,
        "docs/designs"
      )
    ).toEqual({ name: "Redesign", where: "Canvas" });
    expect(changeName("docs/notes.txt", pages, canvasName)).toEqual({
      name: "notes.txt",
      where: "docs",
    });
  });
});

describe("when the last commit was made", () => {
  it("is said as a person says it", () => {
    const now = Date.UTC(2026, 10, 12, 18);
    expect(ago(now - 2 * 60_000, now)).toBe(
      new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        -2,
        "minute"
      )
    );
  });
});

describe("what Commit, pressed too soon, says is missing", () => {
  it("asks for ticked files first, then a message, and is nothing once both are there", () => {
    expect(commitBlocked(0, "Header pass")).toBe("Tick the changes to commit");
    expect(commitBlocked(2, "  ")).toBe("Write a message to commit 2 changes");
    expect(commitBlocked(1, "")).toBe("Write a message to commit 1 change");
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

  it("calls a conflict a conflict, though git writes some with a new or deleted file's letters", () => {
    for (const code of ["AA", "DD", "AU", "UA", "DU", "UD"]) {
      expect(statusWord(code)).toBe("Conflict");
    }
  });
});

describe("Commit's button", () => {
  it("says how many changes it takes once some are ticked", () => {
    expect(commitLabel(0)).toBe("Commit");
    expect(commitLabel(1)).toBe("Commit 1 change");
    expect(commitLabel(3)).toBe("Commit 3 changes");
  });
});

describe("the day a point of the history is listed under", () => {
  const now = new Date(2026, 10, 11, 18, 0);
  const at = (...date: [number, number, number, number, number]) =>
    new Date(...date).getTime();

  it("is Today, Yesterday, the date, and the year when not this one", () => {
    expect(dayOf(at(2026, 10, 11, 9, 5), now)).toBe("Today");
    expect(dayOf(at(2026, 10, 10, 9, 5), now)).toBe("Yesterday");
    expect(dayOf(at(2026, 10, 3, 9, 5), now)).not.toContain("2026");
    expect(dayOf(at(2025, 10, 2, 9, 5), now)).toContain("2025");
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

  it("mark a change in a gutter of their own, and not a line that names a file, a range or a note", () => {
    const diff = [
      "--- a/one.md",
      "+++ b/one.md",
      "@@ -1,2 +1,2 @@",
      " a",
      "",
      "-b",
      "+c",
      "\\ No newline at end of file",
    ].join("\n");
    expect(
      diffLines(diff)
        .filter((line) => line.marked)
        .map((line) => line.text)
    ).toEqual([" a", "", "-b", "+c"]);
  });
});
