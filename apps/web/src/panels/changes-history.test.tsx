// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { Snapshot } from "@ultrapaint/contracts/snapshots";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKept } from "../state/kept.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { Changes } from "./changes.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: Snapshot = { at: 2, files: 3, id: "sn_1", name: "Shown" };

let mounted: Root;
let container: HTMLElement;
const before = useProject.getState().info;

/** A section of the panel, by its title: what its rows say. */
const section = (title: string) =>
  [...container.querySelectorAll("section")].find(
    (s) => s.querySelector("h3")?.textContent === title
  );

beforeEach(() => {
  fakeApi.reset();
  useKept.setState({
    checkpoints: null,
    checkpointsFailed: false,
    snapshots: null,
    snapshotsFailed: false,
  });
  // A folder that is no repository: the panel has its history only.
  useProject.setState({
    error: null,
    info: { ...before, configured: true, repoPath: "/repo" },
  });
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  useProject.setState({ error: null, info: before });
});

describe("Changes › the history", () => {
  it("says which list didn't load under its own title, the other listed", async () => {
    fakeApi.respond("snapshots.list", () => [snapshot]);
    fakeApi.respond("checkpoints.list", () =>
      Promise.reject(new Error("no checkpoints"))
    );
    act(() => mounted.render(<Changes />));
    await act(() => until(useKept, (s) => s.checkpointsFailed));
    expect(section("Snapshots")?.textContent).toContain("Shown");
    expect(section("Agent checkpoints")?.textContent).toContain(
      "The history didn’t loadTry again"
    );

    // Try again reads it: the list takes the place of what said it failed.
    fakeApi.respond("checkpoints.list", () => []);
    act(() => section("Agent checkpoints")?.querySelector("button")?.click());
    await act(() => until(useKept, (s) => s.checkpoints !== null));
    expect(section("Agent checkpoints")?.textContent).toContain("None yet");
  });
});
