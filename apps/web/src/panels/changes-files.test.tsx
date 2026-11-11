// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
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
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
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
});
