import "../testing/fake-browser.ts";
import type { Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zoomBy } from "../lib/shortcuts.ts";
import {
  measureViewportWith,
  nextView,
  setView,
  setViewSoon,
  zoomNotches,
  zoomToFit,
} from "./camera.ts";
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
      // fake clock: a frame is a timer of the fake clock set above.
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
    const hide = measureViewportWith(() => ({ height: 520, width: 920, x: 0 }));
    zoomToFit();
    hide();
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

describe("zoomNotches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    useEditor.setState({ view: { x: 100, y: 50, zoom: 1 } });
  });

  /** The canvas point under `at` on screen. */
  const under = (at: { x: number; y: number }) => {
    const { x, y, zoom } = useEditor.getState().view;
    return { x: (at.x - x) / zoom, y: (at.y - y) / zoom };
  };

  it("glides a notch's step, the point under the cursor staying put", () => {
    const cursor = { x: 400, y: 300 };
    const point = under(cursor);
    zoomNotches(1, cursor);
    vi.advanceTimersByTime(16);
    const between = useEditor.getState().view.zoom;
    // On its way, not there in one jump.
    expect(between).toBeGreaterThan(1);
    expect(between).toBeLessThan(1.25);
    vi.advanceTimersByTime(1000);
    expect(useEditor.getState().view.zoom).toBe(1.25);
    expect(under(cursor).x).toBeCloseTo(point.x, 6);
    expect(under(cursor).y).toBeCloseTo(point.y, 6);
  });

  it("adds a notch to where the last one was going, out as well as in", () => {
    const cursor = { x: 400, y: 300 };
    zoomNotches(1, cursor);
    vi.advanceTimersByTime(16);
    zoomNotches(1, cursor);
    vi.advanceTimersByTime(1000);
    expect(useEditor.getState().view.zoom).toBeCloseTo(1.5625, 9);
    zoomNotches(-2, cursor);
    vi.advanceTimersByTime(1000);
    expect(useEditor.getState().view.zoom).toBeCloseTo(1, 9);
  });

  it("stops where it is when the canvas is moved otherwise", () => {
    zoomNotches(1, { x: 400, y: 300 });
    vi.advanceTimersByTime(16);
    setViewSoon({ x: nextView().x - 10 });
    vi.advanceTimersByTime(1000);
    expect(useEditor.getState().view.zoom).toBeLessThan(1.25);
  });
});
