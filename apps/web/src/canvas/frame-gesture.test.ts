import "../testing/fake-browser.ts";
import type {
  ApplyInput,
  DocumentState,
} from "@ultrapaint/contracts/document";
import type { FrameLayout, Page } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useDocuments } from "../state/documents.ts";
import { layoutSaved, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useCreate } from "./create-tool.ts";
import { useDrag } from "./drag.ts";
import {
  beginFrameGesture,
  cancelGesture,
  followLooseDrag,
  placeFrame,
  resizeFrom,
} from "./frame-gesture.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const box = { height: 100, width: 200, x: 10, y: 20 };

describe("resizeFrom", () => {
  it("keeps the opposite corner where it was", () => {
    expect(resizeFrom(box, "se", 30, 40, 8, false)).toEqual({
      height: 140,
      width: 230,
      x: 10,
      y: 20,
    });
    // Dragging the top left in by (30, 40): the bottom right stays at (210, 120).
    expect(resizeFrom(box, "nw", 30, 40, 8, false)).toEqual({
      height: 60,
      width: 170,
      x: 40,
      y: 60,
    });
  });

  it("goes no smaller than the least size", () => {
    expect(resizeFrom(box, "ne", -500, 500, 8, false)).toEqual({
      height: 8,
      width: 8,
      x: 10,
      y: 112,
    });
  });

  it("keeps the ratio by the side moved further", () => {
    // Twice as wide: twice as tall.
    expect(resizeFrom(box, "se", 200, 10, 8, true)).toEqual({
      height: 200,
      width: 400,
      x: 10,
      y: 20,
    });
  });
});

const frameAt = (x: number, y: number): FrameLayout => ({
  height: 900,
  preset: "desktop",
  width: 1440,
  x,
  y,
});

describe("placeFrame", () => {
  const plain = { ctrlKey: false, metaKey: false, shiftKey: false };

  beforeEach(() => {
    useEditor.setState({
      frames: { a: frameAt(0, 0), b: frameAt(1563, 0) },
      view: { x: 0, y: 0, zoom: 1 },
    });
  });

  it("lands on the grid when it snaps", () => {
    const placed = placeFrame(frameAt(1003, 7), "b", true, plain);
    expect(placed.x % 8).toBe(0);
    expect(placed.y % 8).toBe(0);
  });

  it("snaps to the edges of the frames near it", () => {
    // Four pixels from where its left edge meets the right edge of "a".
    expect(placeFrame(frameAt(1444, 3), "b", false, plain)).toMatchObject({
      x: 1440,
    });
  });

  it("goes exactly where it is put with Shift or ⌘/Ctrl held", () => {
    expect(
      placeFrame(frameAt(1444, 3), "b", false, { ...plain, shiftKey: true })
    ).toMatchObject({ x: 1444, y: 3 });
    expect(
      placeFrame(frameAt(1444, 3), "b", false, { ...plain, metaKey: true })
    ).toMatchObject({ x: 1444, y: 3 });
  });
});

/** The window's pointer listeners, which a gesture follows. */
const listeners = new Map<string, EventListener>();

const pointer = (clientX: number, clientY: number) => ({
  altKey: false,
  clientX,
  clientY,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
});

/** A press on a frame's name or corner, as the frame's chrome hands it on. */
const press = (clientX: number, clientY: number) => ({
  ...pointer(clientX, clientY),
  button: 0,
  currentTarget: { closest: () => null } as unknown as EventTarget,
  pointerId: 1,
  preventDefault: () => undefined,
  stopPropagation: () => undefined,
});

const fire = (type: string, clientX = 0, clientY = 0) =>
  listeners.get(type)?.(pointer(clientX, clientY) as unknown as Event);

const stubWindow = () => {
  listeners.clear();
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", {
    ...window,
    addEventListener: (type: string, fn: EventListener) =>
      listeners.set(type, fn),
    removeEventListener: (type: string, fn: EventListener) => {
      if (listeners.get(type) === fn) {
        listeners.delete(type);
      }
    },
  });
};

describe("followLooseDrag", () => {
  const node = (id: string) => ({
    frame: `node:${id}`,
    nodeId: id,
    origin: { x: 0, y: 0 },
  });

  beforeEach(() => {
    stubWindow();
    useDrag.setState({ dragged: null, drop: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts back a drag whose pointerup never came before beginning the next", () => {
    followLooseDrag(node("a"), pointer(0, 0));
    followLooseDrag(node("b"), pointer(0, 0));
    expect(useDrag.getState().dragged).toMatchObject({ nodeId: "b" });
    // Only the new drag is listened to, and the browser taking the pointer puts it back.
    fire("pointercancel");
    expect(useDrag.getState().dragged).toBeNull();
    expect(listeners.size).toBe(0);
  });
});

describe("a frame gesture", () => {
  const home: Page = {
    canvas: "main",
    file: "designs/home.page.json",
    id: "home.page.json",
    name: "home",
    path: "home.page.json",
    route: "/",
  };
  const start = frameAt(0, 0);
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
          x: 100,
          y: 100,
        },
      ],
      id: "canvas-root",
      type: "group",
    } as DocumentState["root"],
  };
  const NODE = "node:n1";

  const saved = () =>
    fakeApi.calls
      .filter((c) => c.method === "canvas.set")
      .map((c) => (c.input as { frames: Record<string, FrameLayout> }).frames);
  const edits = () =>
    fakeApi.calls
      .filter((c) => c.method === "documents.apply")
      .map((c) => c.input as ApplyInput);

  beforeEach(() => {
    stubWindow();
    fakeApi.reset();
    fakeApi.respond("canvas.set", () => undefined);
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    useCanvasGrid.setState({ visible: false });
    useProject.setState({
      canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
      info: {
        configured: true,
        storage: { mode: "managed" },
      },
      pages: [home],
    });
    useDocuments.setState({ docs: { [CANVAS]: canvasDoc } });
    useEditor.setState({
      canvas: "main",
      frames: { [home.id]: start },
      held: {},
      view: { x: 0, y: 0, zoom: 1 },
    });
    useDrag.setState({ dragged: null, drop: null });
    useCreate.setState({ from: null, to: null });
  });

  afterEach(async () => {
    cancelGesture();
    await layoutSaved();
    vi.unstubAllGlobals();
  });

  it("moving a frame saves it once, rounded, when it is let go", async () => {
    beginFrameGesture(press(0, 0), home.id, "move");
    fire("pointermove", 10.4, 20.6);
    fire("pointermove", 30.3, 40.7);
    expect(useEditor.getState().frames[home.id]).toMatchObject({
      x: 30.3,
      y: 40.7,
    });
    fire("pointerup", 30.3, 40.7);
    expect(listeners.size).toBe(0);
    await layoutSaved();
    expect(saved()).toEqual([{ [home.path]: { ...start, x: 30, y: 41 } }]);
  });

  it("a cancelled pointer puts the frame back and saves nothing", async () => {
    beginFrameGesture(press(0, 0), home.id, "resize", "se");
    fire("pointermove", 100, 50);
    expect(useEditor.getState().frames[home.id]).toMatchObject({
      preset: "custom",
      width: 1540,
    });
    fire("pointercancel");
    expect(useEditor.getState().frames[home.id]).toEqual(start);
    expect(listeners.size).toBe(0);
    await layoutSaved();
    expect(saved()).toEqual([]);
  });

  it("Escape puts the frame back and saves nothing", async () => {
    beginFrameGesture(press(0, 0), home.id, "move");
    fire("pointermove", 300, 200);
    expect(cancelGesture()).toBe(true);
    expect(useEditor.getState().frames[home.id]).toEqual(start);
    expect(listeners.size).toBe(0);
    // Nothing is left to put back, and nothing to stop the key for.
    expect(cancelGesture()).toBe(false);
    await layoutSaved();
    expect(saved()).toEqual([]);
  });

  describe("with a layout pushed meanwhile", () => {
    let stop: () => void = () => undefined;
    const push = (frame: FrameLayout) =>
      fakeApi.emit("canvas", {
        canvas: "main",
        layout: { frames: { [home.path]: frame }, version: 1 },
      });

    beforeEach(async () => {
      stop = followServer({ report: () => undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));
      useEditor.setState({ frames: { [home.id]: start } });
    });

    afterEach(() => stop());

    it("draws the frame where the pointer has it, and its save wins", async () => {
      beginFrameGesture(press(0, 0), home.id, "move");
      fire("pointermove", 300, 200);
      push(frameAt(900, 900));
      expect(useEditor.getState().frames[home.id]).toMatchObject({
        x: 300,
        y: 200,
      });
      fire("pointerup", 300, 200);
      await layoutSaved();
      expect(saved()).toEqual([{ [home.path]: frameAt(300, 200) }]);
      // The next push, once the save is answered, brings it current.
      push(frameAt(900, 900));
      expect(useEditor.getState().frames[home.id]).toMatchObject({
        x: 900,
        y: 900,
      });
    });

    it("put back, draws the frame where the push put it", async () => {
      beginFrameGesture(press(0, 0), home.id, "move");
      fire("pointermove", 300, 200);
      push(frameAt(900, 900));
      expect(cancelGesture()).toBe(true);
      expect(useEditor.getState().frames[home.id]).toMatchObject({
        x: 900,
        y: 900,
      });
      await layoutSaved();
      expect(saved()).toEqual([]);
    });

    it("let go where it was pressed, draws the frame where the push put it", async () => {
      beginFrameGesture(press(0, 0), home.id, "move");
      push(frameAt(900, 900));
      fire("pointerup", 0, 0);
      expect(useEditor.getState().frames[home.id]).toMatchObject({
        x: 900,
        y: 900,
      });
      await layoutSaved();
      expect(saved()).toEqual([]);
    });
  });

  it("Escape puts back a drag and a group being drawn too", () => {
    useDrag.setState({
      dragged: {
        frame: NODE,
        kind: "loose",
        nodeId: "n1",
        origin: { x: 0, y: 0 },
      },
    });
    useCreate.setState({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    expect(cancelGesture()).toBe(true);
    expect(useDrag.getState().dragged).toBeNull();
    expect(useCreate.getState().from).toBeNull();
  });

  it("resizing a node on the canvas holds it at its size and sends one edit", async () => {
    beginFrameGesture(press(0, 0), NODE, "resize", "se");
    fire("pointermove", 4, 2);
    fire("pointermove", 10.4, 5.2);
    expect(useEditor.getState().held[NODE]).toEqual({
      height: 45,
      width: 60,
      x: 100,
      y: 100,
    });
    // Its size is the held box's, not written as if the preview had measured it.
    expect(useEditor.getState().sizes[NODE]).toBeUndefined();
    fire("pointerup", 10.4, 5.2);
    await vi.waitFor(() => expect(edits()).toHaveLength(1));
    expect(edits()).toEqual([
      {
        edits: [
          {
            doc: CANVAS,
            ops: [
              {
                id: "n1",
                op: "update",
                set: { height: 45, width: 60, x: 100, y: 100 },
              },
            ],
          },
        ],
        label: "Resize",
      },
    ]);
    await vi.waitFor(() =>
      expect(useEditor.getState().held[NODE]).toBeUndefined()
    );
  });

  it("a node's resize cancelled sends no edit and draws it as its document has it", async () => {
    beginFrameGesture(press(0, 0), NODE, "resize", "se");
    fire("pointermove", 30, 30);
    expect(useEditor.getState().held[NODE]).toMatchObject({ width: 80 });
    fire("pointercancel");
    expect(useEditor.getState().held[NODE]).toBeUndefined();
    expect(useEditor.getState().sizes[NODE]).toBeUndefined();
    await Promise.resolve();
    expect(edits()).toEqual([]);
  });

  it("a click on a frame's name saves nothing", async () => {
    beginFrameGesture(press(0, 0), home.id, "move");
    fire("pointerup", 0, 0);
    await layoutSaved();
    expect(saved()).toEqual([]);
    expect(useEditor.getState().selectedPage).toBe(home.id);
  });
});
