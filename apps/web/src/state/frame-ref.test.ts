import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { describe, expect, it } from "vitest";
import {
  documentShown,
  dropsOnGround,
  type FrameRef,
  frameIdOf,
  frameRefOf,
  hasPrototypeLinks,
  ownFrameOf,
  pageOfRef,
  takesComments,
  widthOf,
} from "./frame-ref.ts";

const PAGE: FrameRef = { kind: "page", page: "home.page.json" };
const VIEW: FrameRef = { kind: "view", page: "home.page.json", view: "md" };
const NODE: FrameRef = { kind: "node", node: "n1" };
const BOARD: FrameRef = {
  item: "color",
  kind: "board",
  name: "light",
  view: "system",
};

describe("a frame's id", () => {
  it("is read back as the frame it was written for, of each kind", () => {
    expect([PAGE, VIEW, NODE, BOARD].map(frameIdOf)).toEqual([
      "home.page.json",
      "home.page.json#md",
      "node:n1",
      "board:system/color/light",
    ]);
    for (const ref of [PAGE, VIEW, NODE, BOARD]) {
      expect(frameRefOf(frameIdOf(ref))).toEqual(ref);
    }
  });

  it("names a board whose item holds a slash or a #, a guideline's heading", () => {
    const odd: FrameRef = {
      item: "guide-a/b#c",
      kind: "board",
      name: "document",
      view: "system",
    };
    expect(frameRefOf(frameIdOf(odd))).toEqual(odd);
    expect(ownFrameOf(frameIdOf(odd))).toBe(frameIdOf(odd));
  });

  it("says the page a view draws again, and every other frame its own", () => {
    expect(ownFrameOf("home.page.json#md")).toBe("home.page.json");
    expect(ownFrameOf("node:n1")).toBe("node:n1");
    expect(pageOfRef(VIEW)).toBe("home.page.json");
    expect(pageOfRef(NODE)).toBeNull();
    expect(pageOfRef(BOARD)).toBeNull();
  });
});

describe("what a frame takes", () => {
  it("comments and prototype links on a page and its views only", () => {
    expect([PAGE, VIEW, NODE, BOARD].map(takesComments)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([PAGE, VIEW, NODE, BOARD].map(hasPrototypeLinks)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("a drop on the ground around it on the page canvas, none on a board view", () => {
    expect([PAGE, VIEW, NODE, BOARD].map(dropsOnGround)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("shows a page's document, the canvas's loose nodes, or none for a board", () => {
    expect(documentShown(VIEW, "main")).toBe("home.page.json");
    expect(documentShown(NODE, "main")).toBe(canvasDocOf("main"));
    expect(documentShown(BOARD, "main")).toBeNull();
  });

  it("is drawn as wide as its box, a node at its own width, a board at the base", () => {
    const seen = {
      box: { width: 800 },
      root: { id: "n1", type: "row", width: 320 } as never,
    };
    expect(widthOf(VIEW, seen)).toBe(800);
    expect(widthOf(NODE, seen)).toBe(320);
    expect(widthOf(NODE, { box: undefined, root: null })).toBeUndefined();
    expect(widthOf(BOARD, seen)).toBeUndefined();
  });
});
