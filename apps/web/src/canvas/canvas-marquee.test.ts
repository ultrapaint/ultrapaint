// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { FrameLayout, Page } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actedOn } from "../lib/node-actions.ts";
import {
  clearCanvasPicks,
  pickFrames,
  picksInside,
  startCanvasPicks,
  togglePick,
  useCanvasPicks,
} from "../state/canvas-picks.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { usePagePicks } from "../state/page-picks.ts";
import { rightHasSubject } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import {
  inspected,
  select,
  selectedPageNow,
  selectPage,
} from "../state/selection.ts";
import { pageDocs } from "../testing/page-docs.ts";
import {
  beginCanvasMarquee,
  framesTouching,
  useCanvasMarquee,
} from "./canvas-marquee.tsx";
import { putBackGesture } from "./pointer-gesture.ts";

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
  pointerId: 1,
  shiftKey,
});

/** The pointer pressed on the ground moves to a point, as the window hears it. */
const moveTo = (x: number, y: number) =>
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      buttons: 1,
      clientX: x,
      clientY: y,
      pointerId: 1,
    })
  );

/** The pointer is let go. */
const letGo = () =>
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

let stop: () => void = () => undefined;

beforeEach(() => {
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
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
    workspace: "design",
  });
  useCanvasPicks.setState({ drawing: false, ids: [] });
  usePagePicks.setState({ ids: [] });
  stop = startCanvasPicks();
});

afterEach(() => {
  putBackGesture();
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
    moveTo(450, 50);
    expect(useCanvasMarquee.getState().rect).toEqual({
      height: 60,
      width: 460,
      x: -10,
      y: -10,
    });
    expect(useCanvasPicks.getState().ids).toEqual([ABOUT.id, HOME.id, NODE]);
    letGo();
    expect(useCanvasMarquee.getState().rect).toBeNull();
    expect(useCanvasPicks.getState().ids).toHaveLength(3);
    // The pages among them are what a page's menu acts on.
    expect(usePagePicks.getState().ids).toEqual([ABOUT.id, HOME.id]);
  });

  it("selects the one frame it touches, as a click on its name would", () => {
    beginCanvasMarquee(at(-10, 250));
    moveTo(20, 320);
    letGo();
    expect(useCanvasPicks.getState().ids).toEqual([]);
    expect(selectedPageNow()).toBe(SHOP.id);
  });

  it("adds to what is selected with Shift", () => {
    pickFrames([SHOP.id]);
    beginCanvasMarquee(at(-10, -10, true));
    moveTo(20, 20);
    letGo();
    expect(useCanvasPicks.getState().ids).toEqual([SHOP.id, HOME.id]);
  });

  it("is the ground's own press when the pointer did not move", () => {
    select({ frame: HOME.id, nodeId: "x" });
    beginCanvasMarquee(at(1000, 1000));
    moveTo(1001, 1001);
    letGo();
    expect(useCanvasMarquee.getState().rect).toBeNull();
    expect(useEditor.getState().selection).toBeNull();
  });

  it("put away with Escape picks what was picked before", () => {
    pickFrames([HOME.id, ABOUT.id]);
    beginCanvasMarquee(at(-10, 250, true));
    moveTo(20, 320);
    expect(useCanvasPicks.getState().ids).toHaveLength(3);
    putBackGesture();
    expect(useCanvasPicks.getState().ids).toEqual([HOME.id, ABOUT.id]);
  });
});

describe("frames picked together", () => {
  it("leave the right panel away while the marquee is drawn, and are its subject once it is let go (ADR 0121)", () => {
    beginCanvasMarquee(at(-10, -10));
    moveTo(450, 50);
    expect(rightHasSubject()).toBe(false);
    expect(inspected()).toBeNull();
    letGo();
    expect(rightHasSubject()).toBe(true);
  });

  it("are inspected and edited as their roots, each in its own document (ADR 0121)", () => {
    pickFrames([HOME.id, ABOUT.id, NODE]);
    expect(inspected()?.nodes.map((n) => n.id)).toEqual(["root", "root", "n1"]);
    expect(actedOn()).toEqual([
      { frame: HOME.id, nodeId: "root" },
      { frame: ABOUT.id, nodeId: "root" },
      { frame: NODE, nodeId: "n1" },
    ]);
  });

  it("are let go of when anything else is selected", () => {
    pickFrames([HOME.id, ABOUT.id]);
    select({ frame: HOME.id, nodeId: "x" });
    expect(useCanvasPicks.getState().ids).toEqual([]);
    expect(usePagePicks.getState().ids).toEqual([]);
  });

  it("are inspected from the first whose page is still there", () => {
    pickFrames([HOME.id, ABOUT.id, SHOP.id]);
    const { [HOME.id]: _gone, ...docs } = useDocuments.getState().docs;
    useDocuments.setState({ docs });
    expect(inspected()?.frame).toBe(ABOUT.id);
    expect(inspected()?.nodes).toHaveLength(2);
  });

  it("take a frame Shift- or ⌘-clicked, and give one back the same way, one left selected (ADR 0121)", () => {
    selectPage(HOME.id);
    togglePick(ABOUT.id);
    expect(useCanvasPicks.getState().ids).toEqual([HOME.id, ABOUT.id]);
    togglePick(NODE);
    expect(useCanvasPicks.getState().ids).toEqual([HOME.id, ABOUT.id, NODE]);
    togglePick(HOME.id);
    togglePick(NODE);
    expect(useCanvasPicks.getState().ids).toEqual([]);
    expect(selectedPageNow()).toBe(ABOUT.id);
  });

  it("take a frame clicked inside with Shift or ⌘ only while frames are picked as wholes (ADR 0121)", () => {
    selectPage(HOME.id);
    expect(picksInside(ABOUT.id)).toBe(true);
    // Inside the one frame selected, the click still reaches its layers.
    expect(picksInside(HOME.id)).toBe(false);
    pickFrames([HOME.id, ABOUT.id]);
    expect(picksInside(HOME.id)).toBe(true);
    // A layer inside a page selected: a Shift-click adds a layer, as it always has.
    select({ frame: HOME.id, nodeId: "x" });
    expect(picksInside(ABOUT.id)).toBe(false);
  });

  it("are what Escape lets go of first", () => {
    pickFrames([HOME.id, ABOUT.id]);
    expect(clearCanvasPicks()).toBe(true);
    expect(clearCanvasPicks()).toBe(false);
  });
});
