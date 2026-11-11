// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Changes } from "./changes.tsx";

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
const beforeSettings = useProject.getState().settings;

const titles = () =>
  [...container.querySelectorAll("section h3")].map((h) => h.textContent);
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text);
/** The folded group's header: its title and count, and whether it is open. */
const fold = () => {
  const header = container.querySelector<HTMLButtonElement>(
    "section h3 button[aria-expanded]"
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

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("snapshots.list", () => []);
  fakeApi.respond("checkpoints.list", () => []);
  fakeApi.respond("git.status", () => ({
    files: [
      { code: " M", design: true, path: "DESIGN.md" },
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
  useProject.setState({ error: null, info: before, settings: beforeSettings });
});

describe("Changes › the files", () => {
  it("lists Ultrapaint's files, and folds the others under a header that opens them", async () => {
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(titles()).toContain("Design files"));
    expect(fold()).toMatchObject({ open: false, title: "Other files 2" });
    expect(container.textContent).not.toContain("notes.txt");

    act(() => fold()?.click());
    expect(fold()).toMatchObject({ open: true, title: "Other files 2" });
    expect(container.textContent).toContain("notes.txt");

    act(() => fold()?.click());
    expect(fold()?.open).toBe(false);
    expect(container.textContent).not.toContain("notes.txt");
  });

  it("unticks the other files as it folds them, so a commit takes only files in view", async () => {
    useProject.setState({
      settings: { ...defaultSettings("/repo"), git: "on" },
    });
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(titles()).toContain("Design files"));
    act(() => fold()?.click());
    act(() =>
      container
        .querySelector<HTMLElement>('[aria-label="Select notes.txt"]')
        ?.click()
    );
    expect(ticked()).toEqual(["Select notes.txt"]);

    act(() => fold()?.click());
    act(() => fold()?.click());
    expect(ticked()).toEqual([]);
  });

  it("calls the files Files when none of Ultrapaint's changed", async () => {
    fakeApi.respond("git.status", () => ({
      files: [{ code: "??", design: false, path: "notes.txt" }],
    }));
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(fold()?.title).toBe("Files 1"));

    act(() => fold()?.click());
    expect(titles()).toEqual(["Files 1", "Snapshots", "Agent checkpoints"]);
  });

  it("says git didn't answer over the files it listed before, which stay", async () => {
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(titles()).toContain("Design files"));
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
    expect(titles()).toContain("Design files");
  });
});

describe("Changes › a file's diff", () => {
  it("says a file without text changes has none, and Escape goes back to the files", async () => {
    fakeApi.respond("git.diff", ({ path }) => ({ diff: "", path }));
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(titles()).toContain("Design files"));

    act(() =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "DESIGN.md")
        ?.click()
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
    expect(titles()).toContain("Design files");
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
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(titles()).toContain("Design files"));

    act(() => button("DESIGN.md")?.click());
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
