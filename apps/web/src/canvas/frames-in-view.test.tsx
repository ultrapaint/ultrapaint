// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { FrameLayout, Page } from "@ultrapaint/contracts/pages";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { useFramesInView } from "./camera.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const page = (id: string): Page => ({
  canvas: "main",
  file: `designs/${id}.page.json`,
  id: `${id}.page.json`,
  name: id,
  path: `${id}.page.json`,
  route: `/${id}`,
});
const NEAR = page("near");
const FAR = page("far");

const frame = (x: number): FrameLayout => ({
  height: 500,
  preset: "custom",
  width: 500,
  x,
  y: 0,
});

/** Draws what the hook says is in view, as the canvas would draw those frames. */
const Probe = () => {
  const shown = useFramesInView({ height: 800, width: 1000 });
  return <span>{[...shown].sort().join(",")}</span>;
};

const container = document.createElement("div");
const root = createRoot(container);

/** The frames the probe drew. */
const inViewNow = () =>
  (container.textContent ?? "").split(",").filter(Boolean);

/** One frame of the fake clock: what waits for the next frame runs. */
const frameGoesBy = () => act(() => vi.advanceTimersByTime(16));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
    // fake clock: a frame is a timer of the fake clock set above.
    setTimeout(cb, 16)
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  useProject.setState({ pages: [NEAR, FAR] });
  useDocuments.setState({ canvas: "main", docs: {} });
  // FAR is 5000 px off to the right: near the screen only zoomed out.
  useEditor.setState({
    canvas: "main",
    frames: { [FAR.id]: frame(5000), [NEAR.id]: frame(0) },
    view: { x: 0, y: 0, zoom: 1 },
  });
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.render(null));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the frames in view", () => {
  it("are the ones near the screen", () => {
    expect(inViewNow()).toEqual([NEAR.id]);
  });

  it("stay as they are while a zoom goes on, and take the near ones once it rests", () => {
    // Zoomed out a frame at a time: FAR comes near, and is not drawn yet.
    for (const zoom of [0.6, 0.3, 0.15]) {
      act(() => useEditor.setState({ view: { x: 0, y: 0, zoom } }));
      frameGoesBy();
    }
    expect(inViewNow()).toEqual([NEAR.id]);
    // Rested: what the zoom brought near is drawn.
    act(() => vi.advanceTimersByTime(120));
    frameGoesBy();
    expect(inViewNow()).toEqual([FAR.id, NEAR.id].sort());
  });

  it("follow a pan at once", () => {
    act(() => useEditor.setState({ view: { x: -4800, y: 0, zoom: 1 } }));
    frameGoesBy();
    expect(inViewNow()).toContain(FAR.id);
  });
});
