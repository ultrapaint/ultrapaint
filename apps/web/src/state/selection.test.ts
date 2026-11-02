import "../testing/fake-browser.ts";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useDesignSystem } from "./design-system.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { nodeFrameOf } from "./frame-ref.ts";
import {
  drawnNodes,
  frameBreakpoint,
  inspected,
  isSelected,
  select,
  selectedIn,
  selectForMenu,
  selectMany,
  selectPage,
  toggleSelected,
} from "./selection.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";
const ABOUT = "about.page.json";
/** A view of the home page at 800 px: `md`, of the default breakpoints. */
const TABLET = `${HOME}#tablet`;
/** A view of the home page at 390 px: below the first breakpoint, the base. */
const PHONE = `${HOME}#phone`;

const text = (id: string, extra: Partial<DesignNode> = {}): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text", ...extra }) as DesignNode;

const stateOf = (doc: string, root: DesignNode): DocumentState => ({
  doc,
  hash: `${doc}@0`,
  root,
});

const initial = useEditor.getState();
const initialDesignSystem = useDesignSystem.getState();

beforeEach(() => {
  fakeApi.reset();
  useDesignSystem.setState(initialDesignSystem, true);
  useEditor.setState(initial, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [ABOUT]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 1200 },
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
  });
  useDocuments.setState({
    canvas: "main",
    docs: {
      [ABOUT]: stateOf(ABOUT, {
        children: [text("intro")],
        id: "about",
        type: "page",
      }),
      [canvasDocOf("main")]: stateOf(canvasDocOf("main"), {
        children: [
          { ...text("note"), x: 2000, y: 1500 },
          { ...text("banner"), width: 800, x: 0, y: 2000 },
        ],
        id: "canvas",
        type: "group",
      }),
      [HOME]: stateOf(HOME, {
        children: [
          text("title", { align: "center", at: { md: { align: "start" } } }),
          text("lede", { at: { md: { align: "start" } } }),
          text("aside"),
        ],
        id: "home",
        type: "page",
      }),
    },
    loaded: true,
  });
});

describe("the breakpoint a frame is drawn at", () => {
  it.each([
    ["a page's frame, at its width", HOME, "xl"],
    ["a view at 800 px", TABLET, "md"],
    ["a view below the first breakpoint", PHONE, null],
    ["a frame not on the canvas", "gone.page.json", null],
    ["a node on the canvas sized by its content", nodeFrameOf("note"), null],
    ["a node on the canvas at its fixed width", nodeFrameOf("banner"), "md"],
  ])("%s", (_, frame, breakpoint) => {
    expect(frameBreakpoint(frame)).toBe(breakpoint);
  });

  it("is the design system's breakpoints' when it names its own", () => {
    useDesignSystem.setState({
      designSystem: {
        layout: {
          breakpoints: [
            { name: "breakpoint-tablet", value: "600px" },
            { name: "breakpoint-desk", value: "75rem" },
          ],
        },
      } as unknown as DesignSystem,
    });
    expect(frameBreakpoint(TABLET)).toBe("tablet");
    expect(frameBreakpoint(HOME)).toBe("desk");
    expect(frameBreakpoint(PHONE)).toBeNull();
  });
});

describe("selected here", () => {
  it("adds a node Shift-clicked in another view of the page, and takes the selection there", () => {
    select({ frame: HOME, nodeId: "title" });
    toggleSelected({ frame: TABLET, nodeId: "lede" });
    expect(useEditor.getState()).toMatchObject({
      also: [{ frame: TABLET, nodeId: "title" }],
      selection: { frame: TABLET, nodeId: "lede" },
    });
    // Taken out from a third view: the rest stays, there.
    toggleSelected({ frame: PHONE, nodeId: "title" });
    expect(useEditor.getState()).toMatchObject({
      also: [],
      selection: { frame: PHONE, nodeId: "lede" },
    });
  });

  it("starts over on a node Shift-clicked in another page", () => {
    select({ frame: TABLET, nodeId: "title" });
    toggleSelected({ frame: ABOUT, nodeId: "intro" });
    expect(useEditor.getState()).toMatchObject({
      also: [],
      selection: { frame: ABOUT, nodeId: "intro" },
    });
  });

  it("keeps the selection right-clicked in another view, taken there for the menu", () => {
    select({ frame: HOME, nodeId: "title" });
    toggleSelected({ frame: HOME, nodeId: "lede" });
    selectForMenu({ frame: TABLET, nodeId: "title" });
    expect(useEditor.getState()).toMatchObject({
      also: [{ frame: TABLET, nodeId: "title" }],
      selection: { frame: TABLET, nodeId: "lede" },
    });
    // A node not selected is selected alone.
    selectForMenu({ frame: PHONE, nodeId: "aside" });
    expect(useEditor.getState()).toMatchObject({
      also: [],
      selection: { frame: PHONE, nodeId: "aside" },
    });
  });

  it("is the same for the outlines of every view and the layers' rows", () => {
    select({ frame: TABLET, nodeId: "title" });
    toggleSelected({ frame: PHONE, nodeId: "aside" });
    const rows = ["title", "lede", "aside"].filter((id) =>
      // A layers row names the page's own frame.
      isSelected(HOME, id)
    );
    for (const frame of [HOME, TABLET, PHONE]) {
      expect([...selectedIn(frame)].sort()).toEqual([...rows].sort());
      for (const id of rows) {
        expect(isSelected(frame, id)).toBe(true);
      }
    }
    expect(selectedIn(PHONE)).toEqual(["aside", "title"]);
    expect(selectedIn(ABOUT)).toEqual([]);
    expect(isSelected(ABOUT, "title")).toBe(false);
  });
});

describe("the selection as its view draws it", () => {
  it("gives the toolbar a view's values: md's inside the md view", () => {
    const targets = [
      { frame: TABLET, nodeId: "title" },
      { frame: TABLET, nodeId: "lede" },
    ];
    expect(
      drawnNodes(targets).map((n) => (n as { align?: string }).align)
    ).toEqual(["start", "start"]);
    // The page's own frame is at xl, which md holds for; a phone is at the base.
    expect(
      drawnNodes([{ frame: PHONE, nodeId: "title" }]).map(
        (n) => (n as { align?: string }).align
      )
    ).toEqual(["center"]);
  });

  it("gives the inspector the nodes selected at the breakpoint of the view they were selected in", () => {
    selectMany([
      { frame: TABLET, nodeId: "title" },
      { frame: TABLET, nodeId: "aside" },
    ]);
    const shown = inspected();
    expect(shown?.frame).toBe(TABLET);
    expect(
      shown?.nodes.map((n) => [n.id, (n as { align?: string }).align])
    ).toEqual([
      ["title", "start"],
      ["aside", undefined],
    ]);
    selectPage(PHONE);
    expect(inspected()).toMatchObject({ frame: HOME, node: { id: "home" } });
    select(null);
    expect(inspected()).toBeNull();
  });
});

describe("changing the selection", () => {
  const a = { frame: HOME, nodeId: "a" };
  const b = { frame: HOME, nodeId: "b" };
  const c = { frame: HOME, nodeId: "c" };
  const elsewhere = { frame: ABOUT, nodeId: "p" };

  it("toggleSelected adds, takes out and hands the primary on", () => {
    select(a);
    toggleSelected(b);
    expect(useEditor.getState()).toMatchObject({ also: [a], selection: b });
    toggleSelected(c);
    expect(useEditor.getState()).toMatchObject({ also: [a, b], selection: c });
    // Taking out one of the others leaves the primary.
    toggleSelected(a);
    expect(useEditor.getState()).toMatchObject({ also: [b], selection: c });
    // Taking out the primary makes the last one added the primary.
    toggleSelected(c);
    expect(useEditor.getState()).toMatchObject({ also: [], selection: b });
  });

  it("toggleSelected in another frame starts over there", () => {
    select(a);
    toggleSelected(b);
    toggleSelected(elsewhere);
    expect(useEditor.getState()).toMatchObject({
      also: [],
      selection: elsewhere,
    });
  });

  it("selectMany keeps only the first one's frame, and empties on nothing", () => {
    selectMany([a, elsewhere, b]);
    expect(useEditor.getState()).toMatchObject({ also: [b], selection: a });
    selectMany([]);
    expect(useEditor.getState()).toMatchObject({ also: [], selection: null });
  });

  it("selects nothing in the prototype", () => {
    useEditor.setState({ workspace: "prototype" });
    select(a);
    selectMany([a, b]);
    expect(useEditor.getState().selection).toBeNull();
  });
});
