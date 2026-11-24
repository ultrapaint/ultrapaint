// @vitest-environment happy-dom
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { FrameLayout, Page } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useCanvasPicks } from "../state/canvas-picks.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { layoutSaved } from "../state/page-layout.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useDrag } from "./drag.ts";
import { beginFrameGesture, cancelGesture } from "./frame-gesture.ts";
import { useSnapGuides } from "./snap-guides.ts";
import { SnapOverlay } from "./snap-overlay.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const page = (name: string): Page => ({
  canvas: "main",
  file: `designs/${name}.page.json`,
  id: `${name}.page.json`,
  name,
  path: `${name}.page.json`,
  route: `/${name}`,
});
const home = page("home");
const about = page("about");

const frameAt = (x: number, y: number): FrameLayout => ({
  height: 900,
  preset: "desktop",
  width: 1440,
  x,
  y,
});

let host: HTMLDivElement;
let mounted: Root;

/** A press on a frame's name or corner at the window's origin, as its chrome hands it on. */
const press = (keys: { shiftKey?: boolean } = {}) => ({
  altKey: false,
  button: 0,
  clientX: 0,
  clientY: 0,
  ctrlKey: false,
  currentTarget: { closest: () => null } as unknown as EventTarget,
  metaKey: false,
  pointerId: 1,
  preventDefault: () => undefined,
  shiftKey: keys.shiftKey ?? false,
  stopPropagation: () => undefined,
});

/** The pressing pointer's event on the window: its button held while it moves (ADR 0133). */
const pointer = (
  type: string,
  clientX = 0,
  clientY = 0,
  keys: PointerEventInit = {}
) =>
  act(() => {
    window.dispatchEvent(
      new PointerEvent(type, {
        buttons: type === "pointermove" ? 1 : 0,
        clientX,
        clientY,
        pointerId: 1,
        ...keys,
      })
    );
  });

/** About's name pressed, the frame moved by (dx, dy) from where it is, at (2000, 0). */
const moveAbout = (dx: number, dy: number, keys: PointerEventInit = {}) => {
  act(() => beginFrameGesture(press(), about.id, "move"));
  pointer("pointermove", dx, dy, keys);
};

const lines = () => [...host.querySelectorAll<HTMLElement>("[data-snap-line]")];
const pills = () =>
  [...host.querySelectorAll("[data-measure-length]")].map((p) => p.textContent);

const saved = () =>
  fakeApi.calls
    .filter((c) => c.method === "canvas.set")
    .map((c) => (c.input as { frames: Record<string, FrameLayout> }).frames);

beforeEach(() => {
  useSnapGuides.setState({ guides: [] });
  fakeApi.reset();
  fakeApi.respond("canvas.set", () => undefined);
  useCanvasGrid.setState({ visible: false });
  useCanvasPicks.setState({ ids: [] });
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
    info: { configured: true, storage: { mode: "managed" } },
    pages: [home, about],
  });
  useEditor.setState({
    canvas: "main",
    frames: { [about.id]: frameAt(2000, 0), [home.id]: frameAt(0, 0) },
    held: {},
    view: { x: 0, y: 0, zoom: 1 },
  });
  host = document.createElement("div");
  document.body.append(host);
  mounted = createRoot(host);
  act(() => mounted.render(<SnapOverlay />));
});

afterEach(async () => {
  act(() => {
    cancelGesture();
  });
  act(() => mounted.unmount());
  host.remove();
  useCanvasPicks.setState({ ids: [] });
  useCanvasGrid.setState({ visible: false });
  useDocuments.setState({ docs: {} });
  useDrag.setState({ dragged: null, drop: null });
  useSnapGuides.setState({ guides: [] });
  await layoutSaved();
});

describe("a page's frame moved by its name near another", () => {
  it("draws the edge it snaps to across both frames, with the space between them", () => {
    // To (3, 1000): its left edge 3 from home's, 100 under it.
    moveAbout(-1997, 1000);
    expect(lines()).toHaveLength(1);
    const [line] = lines();
    // Home's left edge, from home's top to about's bottom.
    expect(line?.dataset.snapLine).toBe("x");
    expect(line?.style.left).toBe("0px");
    expect(line?.style.top).toBe("0px");
    expect(line?.style.height).toBe("1900px");
    expect(pills()).toEqual(["100"]);
  });

  it("draws its line and pill in the measuring colour, at their size on screen", () => {
    moveAbout(-1997, 1000);
    const [line] = lines();
    const pill = host.querySelector<HTMLElement>("[data-measure-length]");
    expect(line?.className).toContain("bg-measure");
    expect(line?.style.width).toBe("calc(1px * var(--inv))");
    expect(pill?.className).toContain("bg-measure");
    expect(pill?.style.transform).toBe("scale(var(--inv))");
  });

  it("draws a line for each axis it snaps on", () => {
    // To (1444, 3): beside home, its top 3 under home's.
    moveAbout(-556, 3);
    expect(lines().map((l) => l.dataset.snapLine)).toEqual(["x", "y"]);
    // Side by side, the two touch along both lines: no space to give.
    expect(pills()).toEqual([]);
  });

  it("follows the drag, and goes when the frame no longer snaps", () => {
    moveAbout(-1997, 1000);
    expect(lines()).toHaveLength(1);
    pointer("pointermove", -1980, 1000);
    expect(lines()).toEqual([]);
    pointer("pointermove", -2005, 1000);
    expect(lines()).toHaveLength(1);
  });

  it("goes when the frame is let go, which saves it where it snapped", async () => {
    moveAbout(-1997, 1000);
    pointer("pointerup", -1997, 1000);
    expect(lines()).toEqual([]);
    await layoutSaved();
    expect(saved().map((frames) => frames[about.path])).toEqual([
      frameAt(0, 1000),
    ]);
  });

  it("goes when Escape puts the frame back", () => {
    moveAbout(-1997, 1000);
    act(() => {
      cancelGesture();
    });
    expect(lines()).toEqual([]);
  });

  it("goes when the browser takes the pointer away", () => {
    moveAbout(-1997, 1000);
    pointer("pointercancel");
    expect(lines()).toEqual([]);
  });

  it("draws nothing with Shift or ⌘/Ctrl held, the frame going where it is put", () => {
    moveAbout(-1997, 1000);
    pointer("pointermove", -1997, 1000, { shiftKey: true });
    expect(lines()).toEqual([]);
    expect(useEditor.getState().frames[about.id]).toMatchObject({ x: 3 });
    pointer("pointermove", -1997, 1000, { metaKey: true });
    expect(lines()).toEqual([]);
    pointer("pointermove", -1997, 1000, { ctrlKey: true });
    expect(lines()).toEqual([]);
  });

  it("draws nothing with the grid on", () => {
    useCanvasGrid.setState({ visible: true });
    moveAbout(-1997, 1000);
    expect(lines()).toEqual([]);
  });
});

describe("what does not snap to other frames", () => {
  it("draws nothing for a frame resized", () => {
    // About's top left corner taken to (1443, 3), where a move would snap to home's edges.
    act(() => beginFrameGesture(press(), about.id, "resize", "nw"));
    pointer("pointermove", -557, 3);
    expect(useEditor.getState().frames[about.id]).toMatchObject({
      x: 1443,
      y: 3,
    });
    expect(lines()).toEqual([]);
  });

  it("draws nothing for frames picked and moved together", () => {
    useCanvasPicks.setState({ ids: [home.id, about.id] });
    moveAbout(-1997, 1000);
    expect(useEditor.getState().frames[about.id]).toMatchObject({ x: 3 });
    expect(lines()).toEqual([]);
  });

  it("draws nothing for a node on the canvas moved by its name", () => {
    const CANVAS = canvasDocOf("main");
    const canvasDoc: DocumentState = {
      doc: CANVAS,
      hash: `${CANVAS}@0`,
      root: {
        children: [
          {
            height: 40,
            id: "n1",
            role: "paragraph",
            text: "Hi",
            type: "text",
            width: 50,
            x: 1500,
            y: 0,
          },
        ],
        id: "canvas-root",
        type: "group",
      } as DocumentState["root"],
    };
    useDocuments.setState({ docs: { [CANVAS]: canvasDoc } });
    // Its left edge taken to 1443, 3 from home's right edge.
    act(() => beginFrameGesture(press(), "node:n1", "move"));
    pointer("pointermove", -57, 0);
    expect(useDrag.getState().dragged).toMatchObject({ nodeId: "n1" });
    expect(lines()).toEqual([]);
  });
});
