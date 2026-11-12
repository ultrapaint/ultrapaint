// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useEditor } from "./editor.ts";
import { useProject } from "./project.ts";
import { startSelectionReport } from "./selection-report.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const home = {
  canvas: "",
  file: "designs/home.page.json",
  id: "home",
  name: "Home",
  path: "home",
  route: "/home",
} as unknown as Page;

const said = () =>
  fakeApi.calls.filter((c) => c.method === "editor.select").map((c) => c.input);

let stop: () => void = () => undefined;

beforeEach(() => {
  // fake clock: the selection is said once it has stayed put a moment.
  vi.useFakeTimers();
  fakeApi.reset();
  fakeApi.respond("editor.select", () => undefined);
  useProject.setState({ canvases: [], pages: [home] });
  useEditor.setState({ also: [], canvas: "", selection: null });
  stop = startSelectionReport();
});

afterEach(() => {
  stop();
  useEditor.setState({ also: [], selection: null });
  useProject.setState({ canvases: [], pages: [] });
  vi.useRealTimers();
});

describe("the selection, as the server is told it (ADR 0083)", () => {
  it("is said once it stays put, by the references the tools take", async () => {
    useEditor.setState({ selection: { frame: "home", nodeId: "c_1" } });
    useEditor.setState({ selection: { frame: "home", nodeId: "c_2" } });
    await vi.advanceTimersByTimeAsync(250);
    expect(said()).toEqual([{ nodes: [{ name: "c_2", ref: "/home#c_2" }] }]);
  });

  it("is said again when the connection opens anew, the server having forgotten it", async () => {
    useEditor.setState({ selection: { frame: "home", nodeId: "c_1" } });
    await vi.advanceTimersByTimeAsync(250);
    fakeApi.disconnect();
    fakeApi.connect();
    await vi.advanceTimersByTimeAsync(250);
    expect(said()).toHaveLength(2);
  });
});
