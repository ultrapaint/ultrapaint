import "../testing/fake-browser.ts";
import type { Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zoomBy } from "../lib/shortcuts.ts";
import { nextView, setView, setViewSoon, zoomToFit } from "./camera.ts";
import { useEditor } from "./editor.ts";
import { useProject } from "./project.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const home: Page = {
  canvas: "main",
  file: "designs/home.page.json",
  id: "home.page.json",
  name: "home",
  path: "home.page.json",
  route: "/",
};

const initial = useEditor.getState();

beforeEach(() => {
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
    pages: [home],
  });
  useEditor.setState(initial, true);
  useEditor.setState({ canvas: "main" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("setViewSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    useEditor.setState({ view: { x: 0, y: 0, zoom: 1 } });
  });

  it("takes every change of a frame in one, each going on from the last", () => {
    let changes = 0;
    const off = useEditor.subscribe(() => {
      changes += 1;
    });
    setViewSoon({ x: nextView().x - 10 });
    setViewSoon({ x: nextView().x - 10, zoom: 2 });
    expect(useEditor.getState().view).toEqual({ x: 0, y: 0, zoom: 1 });
    vi.advanceTimersByTime(16);
    off();
    expect(changes).toBe(1);
    expect(useEditor.getState().view).toEqual({ x: -20, y: 0, zoom: 2 });
  });

  it("gives way to a fit, which nothing waiting lands on afterwards", () => {
    useEditor.setState({
      frames: {
        [home.id]: { height: 400, preset: "custom", width: 800, x: 0, y: 0 },
      },
    });
    setViewSoon({ x: 999 });
    zoomToFit({ height: 520, width: 920, x: 0 });
    const fitted = useEditor.getState().view;
    expect(fitted).toEqual({ x: 60, y: 60, zoom: 1 });
    vi.advanceTimersByTime(16);
    expect(useEditor.getState().view).toEqual(fitted);
  });

  it("zooms with the keys from a pan still waiting for its frame", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    vi.stubGlobal("window", { ...window, innerHeight: 400, innerWidth: 944 });
    setViewSoon({ x: -100 });
    zoomBy(2);
    // Around the middle of the 400 by 400 left between the panels, from x -100.
    expect(useEditor.getState().view).toEqual({ x: -400, y: -200, zoom: 2 });
    vi.advanceTimersByTime(16);
    expect(useEditor.getState().view).toEqual({ x: -400, y: -200, zoom: 2 });
  });

  it("gives way to a view set outright, which keeps what was waiting", () => {
    setViewSoon({ x: 50 });
    setView({ zoom: 3 });
    expect(useEditor.getState().view).toEqual({ x: 50, y: 0, zoom: 3 });
    vi.advanceTimersByTime(16);
    expect(useEditor.getState().view).toEqual({ x: 50, y: 0, zoom: 3 });
  });
});
