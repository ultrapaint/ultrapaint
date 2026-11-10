// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { FrameLayout, Page } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCanvasPicks,
  pickFrames,
  startCanvasPicks,
  useCanvasPicks,
} from "../state/canvas-picks.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { usePagePicks } from "../state/page-picks.ts";
import { useProject } from "../state/project.ts";
import { select, selectedPageNow } from "../state/selection.ts";
import { pageDocs } from "../testing/page-docs.ts";
import {
  beginCanvasMarquee,
  cancelCanvasMarquee,
  endCanvasMarquee,
  framesTouching,
  moveCanvasMarquee,
  useCanvasMarquee,
} from "./canvas-marquee.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const page = (id: string): Page => ({
  canvas: "main",
  file: `designs/${id}.page.json`,
  id: `${id}.page.json`,
  name: id,
  path: `${id}.page.json`,
  route: `/${id}`,
});
const HOME = page("home");
const ABOUT = page("about");
const SHOP = page("shop");

const frame = (x: number, y: number): FrameLayout => ({
  height: 100,
  preset: "custom",
  width: 100,
  x,
  y,
});

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
        x: 400,
        y: 0,
      },
    ],
    id: "canvas-root",
    type: "group",
  } as DocumentState["root"],
};
const NODE = "node:n1";

/** A pointer at a point of the canvas: the view is at the origin, at 100%. */
const at = (x: number, y: number, shiftKey = false) => ({
  clientX: x,
  clientY: y,
  shiftKey,
});

let stop: () => void = () => undefined;

beforeEach(() => {
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
    pages: [HOME, ABOUT, SHOP],
  });
  useDocuments.setState({
    canvas: "main",
    docs: {
      [CANVAS]: canvasDoc,
      ...pageDocs([HOME.id, ABOUT.id, SHOP.id]),
    },
  });
  useEditor.setState({
    also: [],
    canvas: "main",
    frames: {
      [ABOUT.id]: frame(200, 0),
      [HOME.id]: frame(0, 0),
      [SHOP.id]: frame(0, 300),
    },
    held: {},
    mode: "select",
    selection: null,
    view: { x: 0, y: 0, zoom: 1 },
  });
  useCanvasPicks.setState({ ids: [] });
  usePagePicks.setState({ ids: [] });
  stop = startCanvasPicks();
});

afterEach(() => {
  cancelCanvasMarquee();
  stop();
});

describe("framesTouching", () => {
  it("is every frame a box of the canvas overlaps, a page's views by their page", () => {
    const frames = {
      [`${HOME.id}#mobile`]: frame(0, 150),
      [ABOUT.id]: frame(200, 0),
      [HOME.id]: frame(0, 0),
    };
    expect(
      framesTouching({ height: 200, width: 50, x: 50, y: 50 }, frames)
    ).toEqual([HOME.id]);
    expect(
      framesTouching({ height: 10, width: 300, x: 0, y: 40 }, frames).sort()
    ).toEqual([ABOUT.id, HOME.id].sort());
    // Only touching an edge is not overlapping it.
    expect(
      framesTouching({ height: 10, width: 100, x: 100, y: 0 }, frames)
    ).toEqual([]);
  });
});

describe("the marquee over the ground", () => {
  it("picks what it touches as it is drawn, and keeps them picked once let go", () => {
    beginCanvasMarquee(at(-10, -10));
    moveCanvasMarquee(at(450, 50));
    expect(useCanvasMarquee.getState().rect).toEqual({
      height: 60,
      width: 460,
      x: -10,
      y: -10,
    });
    expect(useCanvasPicks.getState().ids).toEqual([ABOUT.id, HOME.id, NODE]);
    endCanvasMarquee();
    expect(useCanvasMarquee.getState().rect).toBeNull();
    expect(useCanvasPicks.getState().ids).toHaveLength(3);
    // The pages among them are what a page's menu acts on.
    expect(usePagePicks.getState().ids).toEqual([ABOUT.id, HOME.id]);
  });

  it("selects the one frame it touches, as a click on its name would", () => {
    beginCanvasMarquee(at(-10, 250));
    moveCanvasMarquee(at(20, 320));
    endCanvasMarquee();
    expect(useCanvasPicks.getState().ids).toEqual([]);
    expect(selectedPageNow()).toBe(SHOP.id);
  });

  it("adds to what is selected with Shift", () => {
    pickFrames([SHOP.id]);
    beginCanvasMarquee(at(-10, -10, true));
    moveCanvasMarquee(at(20, 20));
    endCanvasMarquee();
    expect(useCanvasPicks.getState().ids).toEqual([SHOP.id, HOME.id]);
  });

  it("is the ground's own press when the pointer did not move", () => {
    select({ frame: HOME.id, nodeId: "x" });
    beginCanvasMarquee(at(1000, 1000));
    moveCanvasMarquee(at(1001, 1001));
    endCanvasMarquee();
    expect(useCanvasMarquee.getState().rect).toBeNull();
    expect(useEditor.getState().selection).toBeNull();
  });

  it("put away with Escape picks what was picked before", () => {
    pickFrames([HOME.id, ABOUT.id]);
    beginCanvasMarquee(at(-10, 250, true));
    moveCanvasMarquee(at(20, 320));
    expect(useCanvasPicks.getState().ids).toHaveLength(3);
    cancelCanvasMarquee();
    expect(useCanvasPicks.getState().ids).toEqual([HOME.id, ABOUT.id]);
  });
});

describe("frames picked together", () => {
  it("are let go of when anything else is selected", () => {
    pickFrames([HOME.id, ABOUT.id]);
    select({ frame: HOME.id, nodeId: "x" });
    expect(useCanvasPicks.getState().ids).toEqual([]);
    expect(usePagePicks.getState().ids).toEqual([]);
  });

  it("are what Escape lets go of first", () => {
    pickFrames([HOME.id, ABOUT.id]);
    expect(clearCanvasPicks()).toBe(true);
    expect(clearCanvasPicks()).toBe(false);
  });
});
