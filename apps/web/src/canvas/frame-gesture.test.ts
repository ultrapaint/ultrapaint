import "../testing/fake-browser.ts";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  AppliedChanges,
  ApplyInput,
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import type { FrameLayout, Page } from "@ultrapaint/contracts/pages";
import { addTokens } from "@ultrapaint/contracts/token-table";
import { applyOps } from "@ultrapaint/design-document/ops";
import { canvasDocOf, findNode } from "@ultrapaint/design-document/tree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useCanvasPicks } from "../state/canvas-picks.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useHeldSizes } from "../state/node-sizing.ts";
import { layoutSaved } from "../state/page-layout.ts";
import { useProject } from "../state/project.ts";
import { select, selectedPageNow } from "../state/selection.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { pageDocs } from "../testing/page-docs.ts";
import { until } from "../testing/until.ts";
import { useCreate } from "./create-tool.ts";
import { useDrag } from "./drag.ts";
import {
  beginFrameGesture,
  beginSpacingDrag,
  cancelGesture,
  followLooseDrag,
  nameClickSelects,
  pickedFramesMoved,
  placeFrame,
  resizeFrom,
  useSpacingDrag,
} from "./frame-gesture.ts";
import type { Band } from "./spacing-bands.ts";

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
    const placed = placeFrame(frameAt(1003, 7), "b", true, plain).frame;
    expect(placed.x % 8).toBe(0);
    expect(placed.y % 8).toBe(0);
  });

  it("snaps to the edges of the frames near it", () => {
    // Four pixels from where its left edge meets the right edge of "a".
    expect(placeFrame(frameAt(1444, 3), "b", false, plain).frame).toMatchObject(
      { x: 1440 }
    );
  });

  it("goes exactly where it is put with Shift or ⌘/Ctrl held", () => {
    expect(
      placeFrame(frameAt(1444, 3), "b", false, { ...plain, shiftKey: true })
        .frame
    ).toMatchObject({ x: 1444, y: 3 });
    expect(
      placeFrame(frameAt(1444, 3), "b", false, { ...plain, metaKey: true })
        .frame
    ).toMatchObject({ x: 1444, y: 3 });
  });
});

/** The window's pointer listeners, which a gesture follows. */
const listeners = new Map<string, EventListener>();

/** The pointer at a point, its button held, as the window hears it while a gesture lasts. */
const pointer = (clientX: number, clientY: number) => ({
  altKey: false,
  buttons: 1,
  clientX,
  clientY,
  ctrlKey: false,
  metaKey: false,
  pointerId: 1,
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
      canvases: [{ home: "/", id: "main", name: "Main" }],
      info: {
        configured: true,
        storage: { mode: "managed" },
      },
      pages: [home],
    });
    useDocuments.setState({
      docs: { [CANVAS]: canvasDoc, ...pageDocs([home.id]) },
    });
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

  it("pressed again before the last move's release came, starts from where the frame was, not where it was drawn", async () => {
    beginFrameGesture(press(0, 0), home.id, "move");
    fire("pointermove", 100, 100);
    beginFrameGesture(press(0, 0), home.id, "move");
    fire("pointermove", 10, 20);
    fire("pointerup", 10, 20);
    await layoutSaved();
    expect(saved()).toEqual([{ [home.path]: { ...start, x: 10, y: 20 } }]);
  });

  it("moves the frames picked together by any one's name, the pages saved as one step", async () => {
    const about: Page = {
      ...home,
      file: "designs/about.page.json",
      id: "about.page.json",
      name: "about",
      path: "about.page.json",
      route: "/about",
    };
    useProject.setState({ pages: [home, about] });
    useEditor.setState({
      frames: { [about.id]: frameAt(2000, 0), [home.id]: start },
    });
    useCanvasPicks.setState({ ids: [home.id, about.id, NODE] });
    beginFrameGesture(press(0, 0), about.id, "move");
    fire("pointermove", 50, 30);
    fire("pointerup", 50, 30);
    await layoutSaved();
    expect(saved()).toEqual([
      {
        [about.path]: { ...frameAt(2000, 0), x: 2050, y: 30 },
        [home.path]: { ...start, x: 50, y: 30 },
      },
    ]);
    await fakeApi.requested("documents.apply");
    expect(edits()).toEqual([
      {
        edits: [
          {
            doc: CANVAS,
            ops: [{ id: "n1", op: "update", set: { x: 150, y: 130 } }],
          },
        ],
        label: "Move",
      },
    ]);
    await until(useEditor, (s) => s.held[NODE] === undefined);
    // The click that ends the move keeps them picked.
    expect(pickedFramesMoved()).toBe(true);
    useCanvasPicks.setState({ ids: [] });
  });

  it("adds a frame by its name pressed with Shift, its click keeping it so with the key let go (ADR 0121)", () => {
    const about = "about.page.json";
    useCanvasPicks.setState({ ids: [home.id, NODE] });
    beginFrameGesture({ ...press(0, 0), shiftKey: true }, about, "move");
    expect(useCanvasPicks.getState().ids).toEqual([home.id, NODE, about]);
    expect(listeners.size).toBe(0);
    // The click after it, Shift let go of by then, picks nothing; asked once.
    expect(pickedFramesMoved()).toBe(true);
    expect(pickedFramesMoved()).toBe(false);
    // A Shift press let go off the name, no click after it: the name activated from the keyboard
    // still selects, and a pointer's click after a press that toggled does not.
    beginFrameGesture({ ...press(0, 0), shiftKey: true }, about, "move");
    expect(nameClickSelects(0)).toBe(true);
    expect(pickedFramesMoved()).toBe(false);
    beginFrameGesture({ ...press(0, 0), shiftKey: true }, about, "move");
    expect(nameClickSelects(1)).toBe(false);
    expect(nameClickSelects(1)).toBe(true);
    // Let go elsewhere, no click asks: the next press forgets it.
    beginFrameGesture({ ...press(0, 0), shiftKey: true }, about, "move");
    beginFrameGesture(press(0, 0), home.id, "resize", "se");
    fire("pointerup");
    expect(pickedFramesMoved()).toBe(false);
    useCanvasPicks.setState({ ids: [] });
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

    beforeEach(() => {
      stop = followServer({ report: () => undefined });
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
    await fakeApi.requested("documents.apply");
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
    // Let go of once the edit is answered.
    await until(useEditor, (s) => s.held[NODE] === undefined);
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
    expect(selectedPageNow()).toBe(home.id);
  });
});

describe("a stack's spacing dragged on the canvas (ADR 0145)", () => {
  const HOME = "home.page.json";
  /** A view of the home page at 800 px: `md`, of the default breakpoints. */
  const TABLET = `${HOME}#tablet`;
  /** A view of the home page at 390 px: below the first breakpoint, the base. */
  const PHONE = `${HOME}#phone`;
  const text = (id: string) =>
    ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;
  const hero = {
    children: [text("title"), text("lede")],
    gap: 8,
    id: "hero",
    padding: 8,
    type: "row",
  } as DesignNode;
  const rect = { height: 20, width: 8, x: 40, y: 8 };
  /** The band between the hero's two children, 8 wide. */
  const GAP: Band = {
    axis: "x",
    field: "gap",
    hit: rect,
    key: "gap-0",
    px: 8,
    rect,
    sign: 1,
  };
  /** The hero's top padding, 8 tall. */
  const TOP: Band = {
    axis: "y",
    field: "padding",
    hit: rect,
    key: "padding-top",
    px: 8,
    rect,
    side: "top",
    sign: 1,
  };
  const heroIn = (doc = HOME) => {
    const root = useDocuments.getState().docs[doc]?.root;
    return root ? findNode(root, "hero") : null;
  };
  const edits = () =>
    fakeApi.calls
      .filter((c) => c.method === "documents.apply")
      .map((c) => c.input as ApplyInput);
  /** The pointer moved with keys held, as the window hears it. */
  const fireWith = (
    type: string,
    clientX: number,
    clientY: number,
    keys: { metaKey?: boolean; shiftKey?: boolean }
  ) =>
    listeners.get(type)?.({
      ...pointer(clientX, clientY),
      ...keys,
    } as unknown as Event);
  const initial = {
    components: useComponents.getState(),
    designSystem: useDesignSystem.getState(),
    documents: useDocuments.getState(),
    editor: useEditor.getState(),
    held: useHeldSizes.getState(),
    project: useProject.getState(),
  };
  let versions = 0;

  beforeEach(() => {
    stubWindow();
    fakeApi.reset();
    // The server's side: the operations applied to the documents the editor has.
    fakeApi.respond("documents.apply", (input: ApplyInput): AppliedChanges => {
      const changes = input.edits.map(({ doc, ops }) => {
        const before = useDocuments.getState().docs[doc];
        if (!before?.root) {
          throw new Error(`no document ${doc}`);
        }
        versions += 1;
        return {
          doc,
          hash: `${doc}@${versions}`,
          root: applyOps(before.root, ops, {
            canvas: false,
            next: () => "n",
          }).root,
        };
      });
      return { changes, created: [] };
    });
    useProject.setState({
      canvases: [{ home: "/", id: "main", name: "Main" }],
      info: { configured: true, storage: { mode: "managed" } },
      pages: [],
    });
    useEditor.setState({
      canvas: "main",
      frames: {
        [HOME]: {
          height: 900,
          preset: "desktop",
          views: [
            { height: 900, id: "tablet", width: 800, x: 1600, y: 0 },
            { height: 900, id: "phone", width: 390, x: 2500, y: 0 },
          ],
          width: 1440,
          x: 0,
          y: 0,
        },
        [PHONE]: { height: 900, preset: "custom", width: 390, x: 2500, y: 0 },
        [TABLET]: { height: 900, preset: "custom", width: 800, x: 1600, y: 0 },
      },
      held: {},
      view: { x: 0, y: 0, zoom: 1 },
    });
    useDocuments.setState({
      canvas: "main",
      docs: {
        [HOME]: {
          doc: HOME,
          hash: `${HOME}@0`,
          root: { children: [hero], id: "home", type: "page" } as DesignNode,
        },
      },
      loaded: true,
    });
    useHeldSizes.setState({ byFrame: {} });
    select({ frame: PHONE, nodeId: "hero" });
  });

  afterEach(() => {
    cancelGesture();
    useComponents.setState(initial.components, true);
    useDesignSystem.setState(initial.designSystem, true);
    useDocuments.setState(initial.documents, true);
    useEditor.setState(initial.editor, true);
    useHeldSizes.setState(initial.held, true);
    useProject.setState(initial.project, true);
    vi.unstubAllGlobals();
  });

  it("holds the stack at the gap the pointer snaps to while it moves", () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fire("pointermove", 3, 0);
    fire("pointermove", 7.6, 0);
    expect(useHeldSizes.getState().byFrame[PHONE]).toEqual({
      gap: 16,
      nodeId: "hero",
    });
  });

  it("says the field, the pixels and the step in the pill while it is dragged, and nothing once let go", () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fire("pointermove", 7.6, 0);
    expect(useSpacingDrag.getState().dragged).toEqual({
      frame: PHONE,
      keys: ["gap-0"],
      label: "Gap 16 · spacing-4",
    });
    fire("pointerup", 7.6, 0);
    expect(useSpacingDrag.getState().dragged).toBeNull();
  });

  it("saves the gap let go of in one edit, which the document then has", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fire("pointermove", 7.6, 0);
    fire("pointerup", 7.6, 0);
    await fakeApi.requested("documents.apply");
    expect(edits()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [{ id: "hero", op: "update", set: { gap: 16 } }],
          },
        ],
        label: "Change the gap",
      },
    ]);
    // Let go of once the document has it, which the inspector reads.
    await until(useHeldSizes, (s) => s.byFrame[PHONE] === undefined);
    expect(heroIn()).toMatchObject({ gap: 16 });
  });

  it("writes a named spacing it snaps to as its token", async () => {
    useDesignSystem.setState({
      designSystem: addTokens(emptyDesignSystem(), [
        { name: "spacing-gutter", value: "1.5rem" },
      ]),
    });
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fire("pointermove", 15, 0);
    fire("pointerup", 15, 0);
    await fakeApi.requested("documents.apply");
    expect(edits()[0]?.edits[0]?.ops).toEqual([
      { id: "hero", op: "update", set: { gap: "$spacing-gutter" } },
    ]);
  });

  it("follows the pointer to the pixel with ⌘/Ctrl held, off the scale", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fireWith("pointermove", 7.2, 0, { metaKey: true });
    expect(useSpacingDrag.getState().dragged?.label).toBe("Gap 15");
    fireWith("pointerup", 7.2, 0, { metaKey: true });
    await fakeApi.requested("documents.apply");
    expect(edits()[0]?.edits[0]?.ops).toEqual([
      { id: "hero", op: "update", set: { gap: 15 } },
    ]);
  });

  it("changes one side of the padding, the others kept, as the inspector's Padding does", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, TOP);
    fire("pointermove", 0, 7.6);
    expect(useHeldSizes.getState().byFrame[PHONE]).toEqual({
      nodeId: "hero",
      padding: { bottom: 8, left: 8, right: 8, top: 16 },
    });
    fire("pointerup", 0, 7.6);
    await fakeApi.requested("documents.apply");
    expect(edits()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [
              {
                id: "hero",
                op: "update",
                set: { padding: { bottom: 8, left: 8, right: 8, top: 16 } },
              },
            ],
          },
        ],
        label: "Change the padding",
      },
    ]);
  });

  it("builds on a padding still being saved when another side is dragged before it lands", async () => {
    const pending = { bottom: 8, left: 8, right: 8, top: 16 };
    useHeldSizes.setState({
      byFrame: { [PHONE]: { nodeId: "hero", padding: pending } },
    });
    const right: Band = {
      ...TOP,
      axis: "x",
      key: "padding-right",
      side: "right",
      sign: -1,
    };
    beginSpacingDrag(press(0, 0), PHONE, hero, right);
    fire("pointermove", -7.6, 0);
    fire("pointerup", -7.6, 0);
    await fakeApi.requested("documents.apply");
    expect(edits()[0]?.edits[0]?.ops).toEqual([
      {
        id: "hero",
        op: "update",
        set: { padding: { bottom: 8, left: 8, right: 16, top: 16 } },
      },
    ]);
  });

  it("changes both sides of the padding's axis with Shift held", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, TOP);
    fireWith("pointermove", 0, 7.6, { shiftKey: true });
    expect(useSpacingDrag.getState().dragged?.keys).toEqual([
      "padding-top",
      "padding-bottom",
    ]);
    fireWith("pointerup", 0, 7.6, { shiftKey: true });
    await fakeApi.requested("documents.apply");
    expect(edits()[0]?.edits[0]?.ops).toEqual([
      {
        id: "hero",
        op: "update",
        set: { padding: { bottom: 16, left: 8, right: 8, top: 16 } },
      },
    ]);
  });

  it("lands at the breakpoint of the view it is dragged in", async () => {
    select({ frame: TABLET, nodeId: "hero" });
    beginSpacingDrag(press(0, 0), TABLET, hero, GAP);
    fire("pointermove", 7.6, 0);
    fire("pointerup", 7.6, 0);
    await fakeApi.requested("documents.apply");
    expect(edits()[0]?.edits[0]?.ops).toEqual([
      { at: "md", id: "hero", op: "update", set: { gap: 16 } },
    ]);
  });

  it("on a layer of an app component's instance, lands as that instance's override (ADR 0114)", async () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [{ ...hero, id: "bar" }],
            id: "p-root",
            type: "column",
          } as DesignNode,
          version: 1,
        },
      ],
    });
    useDocuments.setState({
      docs: {
        [HOME]: {
          doc: HOME,
          hash: `${HOME}@0`,
          root: {
            children: [
              {
                component: "Promo",
                from: "#app",
                id: "promo",
                type: "instance",
              },
            ],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
    select({ frame: PHONE, nodeId: "promo/bar" });
    beginSpacingDrag(press(0, 0), PHONE, { ...hero, id: "promo/bar" }, GAP);
    fire("pointermove", 7.6, 0);
    fire("pointerup", 7.6, 0);
    await fakeApi.requested("documents.apply");
    expect(edits()[0]?.edits[0]?.ops).toEqual([
      expect.objectContaining({
        id: "promo/bar",
        op: "update",
        set: expect.objectContaining({ gap: 16 }),
      }),
    ]);
    await until(useHeldSizes, (s) => s.byFrame[PHONE] === undefined);
    const promo = findNode(
      useDocuments.getState().docs[HOME]?.root ?? null,
      "promo"
    );
    expect(promo).toMatchObject({ overrides: { bar: { gap: 16 } } });
  });

  it("Escape puts the stack back as its document has it and saves nothing", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fire("pointermove", 7.6, 0);
    expect(cancelGesture()).toBe(true);
    expect(useHeldSizes.getState().byFrame[PHONE]).toBeUndefined();
    expect(useSpacingDrag.getState().dragged).toBeNull();
    fire("pointerup", 7.6, 0);
    await Promise.resolve();
    expect(edits()).toEqual([]);
  });

  it("a cancelled pointer puts it back the same way", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, TOP);
    fire("pointermove", 0, 7.6);
    fire("pointercancel");
    expect(useHeldSizes.getState().byFrame[PHONE]).toBeUndefined();
    expect(useSpacingDrag.getState().dragged).toBeNull();
    await Promise.resolve();
    expect(edits()).toEqual([]);
  });

  it("a press let go where it was saves nothing", async () => {
    beginSpacingDrag(press(0, 0), PHONE, hero, GAP);
    fire("pointerup", 0, 0);
    await Promise.resolve();
    expect(edits()).toEqual([]);
  });
});
