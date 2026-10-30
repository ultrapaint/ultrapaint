import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "../testing/fake-browser.ts";
import {
  boardTree,
  followBoardHistory,
  leaveBoard,
  openBoard,
  openBoardInUrl,
  pickOf,
  pickOnBoard,
  placeOfUrl,
  railTabsFor,
  setBoardSize,
  showBoards,
  startBoardView,
  useBoard,
} from "./board.ts";
import { measureViewportWith, setView, zoomToFit } from "./camera.ts";
import { useComponents } from "./components.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { isolate, useIsolation } from "./isolation.ts";
import { select } from "./selection.ts";
import { allFrames } from "./surface.ts";
import { readUrl } from "./url.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";
const HERO = { frame: HOME, nodeId: "hero" };
const PAGE_VIEW = { x: 10, y: 20, zoom: 0.5 };

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [
      { id: "hero", role: "heading", text: "Hi", type: "text" },
      { component: "Promo", from: "#app", id: "promo", type: "instance" },
    ],
    id: "home",
    type: "page",
  } as DocumentState["root"],
};

const initial = useEditor.getState();
const initialBoard = useBoard.getState();

beforeEach(() => {
  useBoard.setState(initialBoard, true);
  useEditor.setState(initial, true);
  useEditor.setState({
    canvas: "",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    leftTab: "layers",
    mode: "group",
    selection: HERO,
    view: PAGE_VIEW,
    workspace: "design",
  });
  useDocuments.setState({ canvas: "", docs: { [HOME]: home } });
  fakeBrowser.visit("/?canvas=main");
  measureViewportWith(() => ({ height: 800, width: 1000, x: 300 }));
});

describe("openBoard", () => {
  it("fits the boards between the panels once measured, the first time an item is opened only", () => {
    const boards = ["board:library/Plan/tone=a", "board:library/Plan/tone=b"];
    /** The two boards drawn side by side, 900 wide each with 24 between them. */
    const drawn = () => {
      showBoards(boards, "row");
      for (const id of boards) {
        setBoardSize(id, { height: 200, width: 900 });
      }
    };
    openBoard({ item: "Plan", view: "library" });
    drawn();
    const fitted = useEditor.getState().view;
    // 1824 wide in the 1000 between the panels, the margins kept on both sides.
    expect(fitted.zoom).toBeCloseTo((1000 - 64) / 1824);
    expect(fitted.x).toBe(332);
    // Moved and left, it is found where it was left: no fit the second time.
    setView({ x: 500, zoom: 0.25 });
    openBoard({ item: "color", view: "system" });
    openBoard({ item: "Plan", view: "library" });
    drawn();
    expect(useEditor.getState().view).toMatchObject({ x: 500, zoom: 0.25 });
  });

  it("leaves the camera where the user moved it before the boards were measured", () => {
    openBoard({ item: "Plan", view: "library" });
    showBoards(["board:library/Plan/a"], "column");
    setView({ x: 10 });
    setBoardSize("board:library/Plan/a", { height: 200, width: 3000 });
    expect(useEditor.getState().view).toMatchObject({ x: 10, zoom: 1 });
  });

  it("puts the page aside and opens the item at 100%, past the left panel", () => {
    openBoard({ item: "color", view: "system" });
    expect(useBoard.getState().open).toEqual({ item: "color", view: "system" });
    expect(useEditor.getState()).toMatchObject({
      leftTab: "designSystem",
      mode: "select",
      selection: null,
      view: { x: 332, y: 72, zoom: 1 },
    });
    expect(readUrl().board).toEqual({ item: "color", view: "system" });
    // Opening a board from the page is a navigation of its own.
    expect(fakeBrowser.history().entries).toHaveLength(2);
  });

  it("selects nothing of a page while it is open", () => {
    openBoard({ item: "Button", view: "library" });
    select(HERO);
    expect(useEditor.getState().selection).toBeNull();
  });

  it("goes from item to item in the same entry, each item's camera kept", () => {
    openBoard({ item: "color", view: "system" });
    useEditor.setState({ view: { x: 1, y: 2, zoom: 2 } });
    openBoard({ item: "spacing", view: "system" });
    expect(useEditor.getState().view).toEqual({ x: 332, y: 72, zoom: 1 });
    openBoard({ item: "color", view: "system" });
    expect(useEditor.getState().view).toEqual({ x: 1, y: 2, zoom: 2 });
    expect(fakeBrowser.history().entries).toHaveLength(2);
    expect(readUrl().board).toEqual({ item: "color", view: "system" });
  });

  it("leaves an app component edited in place, its instance what the page is found with", () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          props: [],
          tree: { children: [], id: "promo-root", type: "column" },
          version: 1,
        } as never,
      ],
    });
    isolate(HOME, {
      component: "Promo",
      from: "#app",
      id: "promo",
      type: "instance",
    });
    openBoard({ item: "color", view: "system" });
    expect(useIsolation.getState().isolated).toBeNull();
    leaveBoard();
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "promo",
    });
  });
});

describe("leaveBoard", () => {
  it("finds the page as it was: its camera, its selection, its tool and its panel", () => {
    openBoard({ item: "color", view: "system" });
    openBoard({ item: "Button", view: "library" });
    leaveBoard();
    expect(useBoard.getState().open).toBeNull();
    expect(useEditor.getState()).toMatchObject({
      leftTab: "layers",
      mode: "group",
      selection: HERO,
      view: PAGE_VIEW,
    });
    expect(readUrl().board).toBeNull();
    expect(readUrl().canvas).toBe("main");
  });

  it("shows the Library on the page when the board was opened from Design system's panel", () => {
    useEditor.setState({ leftTab: "designSystem" });
    openBoard({ item: "Button", view: "library" });
    leaveBoard();
    expect(useEditor.getState().leftTab).toBe("library");
  });

  it("gives way to the prototype, the page's selection put aside for the canvas", () => {
    const stop = startBoardView();
    openBoard({ item: "color", view: "system" });
    useEditor.getState().setWorkspace("prototype");
    stop();
    expect(useBoard.getState().open).toBeNull();
    expect(useEditor.getState().view).toEqual(PAGE_VIEW);
    expect(readUrl().board).toBeNull();
    useEditor.getState().setWorkspace("design");
    expect(useEditor.getState()).toMatchObject({
      mode: "group",
      selection: HERO,
    });
  });
});

describe("picks", () => {
  it("are each item's own", () => {
    openBoard({ item: "color", view: "system" });
    const pick = {
      frame: "board:system/color/palette",
      nodeId: "token:color-primary",
    };
    pickOnBoard(pick);
    openBoard({ item: "spacing", view: "system" });
    expect(pickOf(useBoard.getState())).toBeNull();
    openBoard({ item: "color", view: "system" });
    expect(pickOf(useBoard.getState())).toEqual(pick);
    pickOnBoard(null);
    expect(pickOf(useBoard.getState())).toBeNull();
  });
});

describe("frames", () => {
  it("are the camera's while a board view is open, the pages' after", () => {
    openBoard({ item: "color", view: "system" });
    const box = { height: 200, width: 400, x: 0, y: 0 };
    showBoards(["board:system/color/palette"], "column");
    setBoardSize("board:system/color/palette", { height: 200, width: 400 });
    expect(allFrames()).toEqual({ "board:system/color/palette": box });
    zoomToFit();
    // 1000 pixels seen, less 60 a side, over 400.
    expect(useEditor.getState().view.zoom).toBeCloseTo(2.2);
    leaveBoard();
    expect(Object.keys(allFrames())).toEqual([HOME]);
  });
});

const PLAN = {
  name: "Plan",
  origin: "app",
  properties: [
    {
      default: "default",
      kind: "choice",
      members: ["default", "featured"],
      name: "tone",
    },
  ],
  slots: [],
  tree: {
    children: [{ id: "price", role: "paragraph", text: "$24", type: "text" }],
    id: "plan-root",
    type: "column",
  },
  version: 1,
} as const;

const FEATURED = "board:library/Plan/tone=featured";

describe("the rail", () => {
  it("has no Layers on a board view, but on an app component's", () => {
    expect(railTabsFor(null)).toContain("layers");
    expect(railTabsFor({ item: "color", view: "system" })).toEqual([
      "chat",
      "designSystem",
      "library",
      "changes",
    ]);
    useComponents.setState({ components: [PLAN] });
    expect(railTabsFor({ item: "Plan", view: "library" })).toContain("layers");
    expect(railTabsFor({ item: "Button", view: "library" })).not.toContain(
      "layers"
    );
  });
});

describe("an app component's board", () => {
  it("edits its tree in place where a node of it is selected, landing on the board's member", () => {
    useComponents.setState({ components: [PLAN] });
    openBoard({ item: "Plan", view: "library" });
    // From Layers: a node of the tree selected on the first variant's board.
    const tree = boardTree(useBoard.getState().open, {});
    expect(tree).toEqual({
      frame: "board:library/Plan/tone=default",
      root: PLAN.tree,
    });
    select({ frame: FEATURED, nodeId: "price" });
    expect(useEditor.getState().selection).toEqual({
      frame: FEATURED,
      nodeId: "price",
    });
    expect(useIsolation.getState().isolated).toMatchObject({
      component: "Plan",
      frame: FEATURED,
      variant: { member: "featured", property: "tone" },
    });
    expect(boardTree(useBoard.getState().open, {})?.frame).toBe(FEATURED);
    // Nothing else of a board takes a selection.
    select({ frame: "board:library/Plan/elsewhere", nodeId: "x" });
    expect(useEditor.getState().selection?.frame).toBe(FEATURED);
    // Another item leaves the tree, and selects nothing.
    openBoard({ item: "Button", view: "library" });
    expect(useIsolation.getState().isolated).toBeNull();
    expect(useEditor.getState().selection).toBeNull();
  });
});

describe("the URL", () => {
  it("names a board view, its item the view's first when it names none", () => {
    expect(placeOfUrl({ item: "Button", view: "library" })).toEqual({
      item: "Button",
      view: "library",
    });
    expect(placeOfUrl({ item: null, view: "system" })).toEqual({
      item: "color",
      view: "system",
    });
    expect(placeOfUrl({ item: "x", view: "everything" })).toBeNull();
    expect(placeOfUrl(null)).toBeNull();
  });

  it("opens the board view a reload or a link names, in the entry it was loaded at", () => {
    fakeBrowser.visit("/?canvas=main&view=library");
    openBoardInUrl();
    expect(useBoard.getState().open).toEqual({
      item: "overview",
      view: "library",
    });
    expect(window.location.search).toBe(
      "?canvas=main&view=library&item=overview"
    );
    expect(fakeBrowser.history().entries).toHaveLength(1);
  });

  it("follows back to the page and forward to the board", () => {
    const stop = followBoardHistory();
    openBoard({ item: "Button", view: "library" });
    window.history.back();
    expect(useBoard.getState().open).toBeNull();
    expect(useEditor.getState().view).toEqual(PAGE_VIEW);
    window.history.forward();
    expect(useBoard.getState().open).toEqual({
      item: "Button",
      view: "library",
    });
    stop();
  });
});
