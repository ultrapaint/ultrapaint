// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Changes } from "./changes.tsx";
import { useCommitDraft } from "./changes-git.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;
const before = useProject.getState().info;

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text);
/** The folded group's header: its title and count, and whether it is open. */
const fold = () => {
  const header = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]"
  );
  return header
    ? {
        click: () => header.click(),
        open: header.getAttribute("aria-expanded") === "true",
        title: header.textContent,
      }
    : null;
};
const ticked = () =>
  [...container.querySelectorAll("[role=checkbox][aria-checked=true]")].map(
    (c) => c.getAttribute("aria-label")
  );
const commitButton = () =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith("Commit")
  );

/** The panel on screen, on its Git tab. */
const showGit = () => {
  act(() => mounted.render(<Changes />));
  act(() => button("Git")?.click());
};

beforeEach(() => {
  fakeApi.reset();
  useCommitDraft.setState({
    message: "",
    ticked: new Set(),
    unticked: new Set(),
  });
  fakeApi.respond("history.get", () => ({ pending: null, points: [] }));
  fakeApi.respond("git.status", () => ({
    branch: "main",
    files: [
      {
        code: " M",
        design: true,
        lines: { added: 12, removed: 3 },
        path: "DESIGN.md",
      },
      { code: " M", design: false, path: "apps/web/src/panels/changes.tsx" },
      { code: "??", design: false, path: "notes.txt" },
    ],
  }));
  useProject.setState({
    error: null,
    info: {
      ...before,
      configured: true,
      gitRepository: true,
      repoPath: "/repo",
    },
  });
  container = document.createElement("div");
  // In the document, so what has the focus takes the keys.
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => mounted.unmount());
  container.remove();
  useProject.setState({ error: null, info: before });
});

describe("Changes › the Git tab", () => {
  it("ticks Ultrapaint's changes, with their lines, and folds the others unticked", async () => {
    showGit();
    await vi.waitFor(() => expect(ticked()).toEqual(["Commit DESIGN.md"]));
    expect(container.textContent).toContain(
      "12 lines added, 3 lines removed+12−3"
    );
    expect(fold()).toMatchObject({ open: false, title: "Other files2" });
    expect(container.textContent).not.toContain("notes.txt");
    expect(commitButton()?.textContent).toBe("Commit 1 change");
    // The commit card says the branch it commits to.
    expect(container.textContent).toContain("Messagemain");

    act(() => fold()?.click());
    expect(container.textContent).toContain("notes.txt");
    expect(ticked()).toEqual(["Commit DESIGN.md"]);
  });

  it("unticks the other files as it folds them, so a commit takes only files in view", async () => {
    showGit();
    await vi.waitFor(() => expect(fold()).not.toBeNull());
    act(() => fold()?.click());
    act(() =>
      container
        .querySelector<HTMLElement>('[aria-label="Commit notes.txt"]')
        ?.click()
    );
    expect(ticked()).toEqual(["Commit DESIGN.md", "Commit notes.txt"]);

    act(() => fold()?.click());
    act(() => fold()?.click());
    expect(ticked()).toEqual(["Commit DESIGN.md"]);
  });

  it("says what is missing when Commit is pressed too soon, and commits the ticked changes", async () => {
    fakeApi.respond("git.commit", () => ({ sha: "abc" }));
    showGit();
    await vi.waitFor(() => expect(commitButton()).toBeDefined());
    act(() => commitButton()?.click());
    expect(container.textContent).toContain(
      "Write a message to commit 1 change"
    );

    act(() => useCommitDraft.setState({ message: "Tighten the header" }));
    await act(async () => {
      commitButton()?.click();
      await fakeApi.requested("git.commit");
    });
    expect(fakeApi.calls.find((c) => c.method === "git.commit")).toMatchObject({
      input: { message: "Tighten the header", paths: ["DESIGN.md"] },
    });
  });

  it("says there is nothing to commit, with the last commit", async () => {
    fakeApi.respond("git.status", () => ({
      branch: "main",
      files: [],
      lastCommit: { at: Date.now() - 120_000, message: "Tighten the header" },
    }));
    showGit();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Nothing to commit")
    );
    expect(container.textContent).toContain("“Tighten the header”");
    expect(commitButton()).toBeUndefined();
  });

  it("says git didn't answer over the files it listed before, which stay", async () => {
    showGit();
    await vi.waitFor(() => expect(ticked()).toEqual(["Commit DESIGN.md"]));
    const stop = followServer({ report: () => undefined });
    fakeApi.respond("git.status", () =>
      Promise.reject(new Error("git status exited 128"))
    );

    // fake clock: the panel lets the files settle before it reads them again.
    vi.useFakeTimers();
    act(() => fakeApi.emit("file.changed", { file: "DESIGN.md", hash: "h" }));
    await act(() => vi.advanceTimersByTimeAsync(250));
    stop();
    expect(container.textContent).toContain("Git didn’t answerTry again");
    expect(ticked()).toEqual(["Commit DESIGN.md"]);
  });
});

describe("Changes › a file's diff", () => {
  it("says a file without text changes has none, and Escape goes back to the files", async () => {
    fakeApi.respond("git.diff", ({ path }) => ({ diff: "", path }));
    showGit();
    await vi.waitFor(() => expect(ticked()).toEqual(["Commit DESIGN.md"]));

    act(() =>
      [
        ...container.querySelectorAll("button[data-row-button]"),
      ][0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(container.querySelector("h2")?.textContent).toBe("DESIGN.md");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("No text changes in this file")
    );
    expect(container.querySelector("pre")).toBeNull();

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      )
    );
    expect(ticked()).toEqual(["Commit DESIGN.md"]);
  });
});

describe("Changes › a diff on its way", () => {
  it("opens at once under its title, loading, and says in place when it didn't load", async () => {
    let fail: (error: Error) => void = () => undefined;
    fakeApi.respond(
      "git.diff",
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    showGit();
    await vi.waitFor(() => expect(ticked()).toEqual(["Commit DESIGN.md"]));

    act(() =>
      [
        ...container.querySelectorAll("button[data-row-button]"),
      ][0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(container.querySelector("h2")?.textContent).toBe("DESIGN.md");
    expect(container.querySelector("[role=status]")).not.toBeNull();

    await act(async () => fail(new Error("git diff exited 128")));
    expect(container.textContent).toContain("The changes didn’t loadTry again");
    expect(useProject.getState().error).toBeNull();

    // Try again reads it again: the diff takes the place of what said it failed.
    fakeApi.respond("git.diff", ({ path }) => ({
      diff: "--- a/DESIGN.md\n+++ b/DESIGN.md\n@@ -1 +1 @@\n-old\n+new\n",
      path,
    }));
    act(() => button("Try again")?.click());
    await vi.waitFor(() =>
      expect(container.querySelector("pre")).not.toBeNull()
    );
    expect(container.textContent).not.toContain("didn’t load");
  });
});
