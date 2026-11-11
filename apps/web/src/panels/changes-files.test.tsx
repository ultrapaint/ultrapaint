// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
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

const titles = () =>
  [...container.querySelectorAll("section h3")].map((h) => h.textContent);
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text);

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
  useProject.setState({ error: null, info: before });
});

describe("Changes › the files", () => {
  it("lists Ultrapaint's files, and the others only when asked", async () => {
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(titles()).toContain("Design files"));
    expect(titles()).not.toContain("Other files");
    expect(container.textContent).not.toContain("notes.txt");

    act(() => button("Show 2 other files")?.click());
    expect(titles()).toContain("Other files");
    expect(container.textContent).toContain("notes.txt");

    act(() => button("Hide")?.click());
    expect(titles()).not.toContain("Other files");
    expect(button("Show 2 other files")).toBeDefined();
  });

  it("calls the files Files when none of Ultrapaint's changed", async () => {
    fakeApi.respond("git.status", () => ({
      files: [{ code: "??", design: false, path: "notes.txt" }],
    }));
    act(() => mounted.render(<Changes />));
    await vi.waitFor(() => expect(button("Show 1 file")).toBeDefined());

    act(() => button("Show 1 file")?.click());
    expect(titles()).toEqual(["Files", "Snapshots", "Agent checkpoints"]);
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
    await vi.waitFor(() =>
      expect(container.querySelector("h2")?.textContent).toBe("DESIGN.md")
    );
    expect(container.textContent).toContain("No text changes in this file");
    expect(container.querySelector("pre")).toBeNull();

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      )
    );
    expect(titles()).toContain("Design files");
  });
});
