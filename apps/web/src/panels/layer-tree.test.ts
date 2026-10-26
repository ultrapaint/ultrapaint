import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { describe, expect, it } from "vitest";
import {
  filterLayers,
  type LayerItem,
  looseItem,
  openUnless,
  pageItem,
  pageKey,
  pagesOpen,
  treeMove,
  type VisibleRow,
  visibleRows,
} from "./layer-tree.ts";

const text = (id: string, words: string): DesignNode => ({
  id,
  role: "paragraph",
  text: words,
  type: "text",
});

const column = (
  id: string,
  children: DesignNode[],
  name?: string
): DesignNode => ({
  children,
  id,
  type: "column",
  ...(name !== undefined && { name }),
});

const button = (id: string): DesignNode => ({
  component: "Button",
  from: "@acme/ui/button",
  id,
  text: "Buy",
  type: "instance",
});

const page: Page = {
  canvas: "",
  file: "designs/home.page.json",
  id: "home",
  name: "Home",
  path: "home.page.json",
};

/** A page with a hero holding a title and a call to action, and a footer; a note on the canvas. */
const root: DesignNode = {
  children: [
    column("hero", [text("title", "Welcome aboard"), button("cta")], "Hero"),
    column("footer", [text("legal", "All rights reserved")], "Footer"),
  ],
  id: "root",
  type: "page",
};

const items: LayerItem[] = [
  pageItem(page, root),
  looseItem("node:note", text("note", "Remember the footer")),
];

/** The keys of a tree, depth first, each indented by its level. */
const outline = (list: readonly LayerItem[], depth = 0): string[] =>
  list.flatMap((item) => [
    `${"  ".repeat(depth)}${item.key}`,
    ...outline(item.children, depth + 1),
  ]);

describe("filtering the layers", () => {
  it("leaves every row when nothing is typed", () => {
    expect(filterLayers(items, "  ")).toBe(items);
  });

  it("keeps a match with the rows it is written under, and nothing else", () => {
    expect(outline(filterLayers(items, "welcome"))).toEqual([
      "home#page",
      "  home#hero",
      "    home#title",
    ]);
  });

  it("matches names, components and what instances say, case aside", () => {
    expect(outline(filterLayers(items, "BUTTON"))).toEqual([
      "home#page",
      "  home#hero",
      "    home#cta",
    ]);
    expect(outline(filterLayers(items, "buy"))).toEqual([
      "home#page",
      "  home#hero",
      "    home#cta",
    ]);
  });

  it("keeps of a matching row only those of its own that match too", () => {
    expect(outline(filterLayers(items, "footer"))).toEqual([
      "home#page",
      "  home#footer",
      "node:note#note",
    ]);
  });

  it("finds a page by its name", () => {
    expect(outline(filterLayers(items, "home"))).toEqual(["home#page"]);
  });

  it("leaves nothing when nothing matches", () => {
    expect(filterLayers(items, "pricing")).toEqual([]);
  });
});

describe("the rows that can be seen", () => {
  it("lists open rows with their level and the row they are under", () => {
    const rows = visibleRows(items, openUnless(new Set()));
    expect(rows.map((r) => [r.key, r.level, r.parent])).toEqual([
      ["home#page", 1, null],
      ["home#hero", 2, "home#page"],
      ["home#title", 3, "home#hero"],
      ["home#cta", 3, "home#hero"],
      ["home#footer", 2, "home#page"],
      ["home#legal", 3, "home#footer"],
      ["node:note#note", 1, null],
    ]);
  });

  it("leaves out the rows of a folded one", () => {
    const rows = visibleRows(items, openUnless(new Set(["home#hero"])));
    expect(rows.map((r) => r.key)).toEqual([
      "home#page",
      "home#hero",
      "home#footer",
      "home#legal",
      "node:note#note",
    ]);
    expect(rows[1]).toMatchObject({ expandable: true, expanded: false });
  });
});

describe("how the panel starts out", () => {
  it("opens the pages and folds the layers in them", () => {
    const rows = visibleRows(items, pagesOpen(new Set()));
    expect(rows.map((r) => r.key)).toEqual([
      "home#page",
      "home#hero",
      "home#footer",
      "node:note#note",
    ]);
  });

  it("opens a layer that was flipped, and folds a page that was", () => {
    expect(
      visibleRows(items, pagesOpen(new Set(["home#hero"]))).map((r) => r.key)
    ).toEqual([
      "home#page",
      "home#hero",
      "home#title",
      "home#cta",
      "home#footer",
      "node:note#note",
    ]);
    expect(
      visibleRows(items, pagesOpen(new Set([pageKey("home")]))).map(
        (r) => r.key
      )
    ).toEqual(["home#page", "node:note#note"]);
  });

  it("says where each row sits among its siblings and what it is drawn under", () => {
    const rows = visibleRows(items, openUnless(new Set()));
    const title = rows.find((r) => r.key === "home#title");
    expect(title?.guides).toEqual(["home#page", "home#hero"]);
    expect([title?.position, title?.siblings]).toEqual([1, 2]);
  });
});

describe("walking the tree with the keyboard", () => {
  const rows: readonly VisibleRow[] = visibleRows(
    items,
    openUnless(new Set(["home#footer"]))
  );

  it("goes down and up through the rows that can be seen", () => {
    expect(treeMove(rows, "home#cta", "ArrowDown")).toEqual({
      focus: "home#footer",
    });
    expect(treeMove(rows, "home#footer", "ArrowDown")).toEqual({
      focus: "node:note#note",
    });
    expect(treeMove(rows, "home#hero", "ArrowUp")).toEqual({
      focus: pageKey("home"),
    });
  });

  it("stops at either end, where Home and End go", () => {
    expect(treeMove(rows, "node:note#note", "ArrowDown")).toBeNull();
    expect(treeMove(rows, "home#page", "ArrowUp")).toBeNull();
    expect(treeMove(rows, "home#title", "Home")).toEqual({
      focus: "home#page",
    });
    expect(treeMove(rows, "home#title", "End")).toEqual({
      focus: "node:note#note",
    });
  });

  it("opens a folded row to the right, then goes into it", () => {
    expect(treeMove(rows, "home#footer", "ArrowRight")).toEqual({
      expand: "home#footer",
    });
    expect(treeMove(rows, "home#hero", "ArrowRight")).toEqual({
      focus: "home#title",
    });
    expect(treeMove(rows, "home#title", "ArrowRight")).toBeNull();
  });

  it("folds an open row to the left, else goes up to the row it is under", () => {
    expect(treeMove(rows, "home#hero", "ArrowLeft")).toEqual({
      collapse: "home#hero",
    });
    expect(treeMove(rows, "home#footer", "ArrowLeft")).toEqual({
      focus: "home#page",
    });
    expect(treeMove(rows, "home#cta", "ArrowLeft")).toEqual({
      focus: "home#hero",
    });
    expect(treeMove(rows, "node:note#note", "ArrowLeft")).toBeNull();
  });

  it("starts from the first row when the focus is on none", () => {
    expect(treeMove(rows, "gone#row", "ArrowDown")).toEqual({
      focus: "home#page",
    });
    expect(treeMove(rows, null, "Enter")).toBeNull();
  });
});
