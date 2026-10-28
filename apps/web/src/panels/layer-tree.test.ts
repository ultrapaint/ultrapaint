import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { describe, expect, it } from "vitest";
import {
  type DropPosition,
  dropOf,
  dropPositionAt,
  type Folds,
  filterLayers,
  findItem,
  flip,
  isOpenIn,
  type LayerItem,
  looseItem,
  NO_FOLDS,
  oneLevelFolded,
  oneLevelOpen,
  openUnless,
  pageItem,
  pageKey,
  revealed,
  treeMove,
  type VisibleRow,
  visibleRows,
  withQuery,
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

describe("one level at a time", () => {
  it("opens every folded branch one level", () => {
    const rows = visibleRows(
      items,
      openUnless(new Set(["home#hero", "home#footer"]))
    );
    expect(oneLevelOpen(rows)).toEqual(["home#hero", "home#footer"]);
  });

  it("folds the innermost open rows of each branch, then the ones above", () => {
    const all = visibleRows(items, openUnless(new Set()));
    expect(oneLevelFolded(all)).toEqual(["home#hero", "home#footer"]);
    const less = visibleRows(
      items,
      openUnless(new Set(["home#hero", "home#footer"]))
    );
    expect(oneLevelFolded(less)).toEqual(["home#page"]);
  });
});

/** The keys of the rows that can be seen with these folds. */
const seen = (folds: Folds, list: readonly LayerItem[] = items) =>
  visibleRows(list, isOpenIn(folds)).map((r) => r.key);

describe("how the panel starts out", () => {
  it("opens the pages and folds the layers in them", () => {
    const rows = visibleRows(items, isOpenIn(NO_FOLDS));
    expect(rows.map((r) => r.key)).toEqual([
      "home#page",
      "home#hero",
      "home#footer",
      "node:note#note",
    ]);
  });

  it("opens a layer that was flipped, and folds a page that was", () => {
    expect(seen(flip(NO_FOLDS, ["home#hero"]))).toEqual([
      "home#page",
      "home#hero",
      "home#title",
      "home#cta",
      "home#footer",
      "node:note#note",
    ]);
    expect(seen(flip(NO_FOLDS, [pageKey("home")]))).toEqual([
      "home#page",
      "node:note#note",
    ]);
  });

  it("says where each row sits among its siblings and what it is drawn under", () => {
    const rows = visibleRows(items, openUnless(new Set()));
    const title = rows.find((r) => r.key === "home#title");
    expect(title?.guides).toEqual(["home#page", "home#hero"]);
    expect([title?.position, title?.siblings]).toEqual([1, 2]);
  });
});

describe("folding while a filter is typed", () => {
  const typed = withQuery(NO_FOLDS, "o");

  it("starts out with every row open, the panel's own folds kept aside", () => {
    expect(seen(typed)).toEqual(outline(items).map((key) => key.trim()));
    const folded = flip(typed, ["home#hero"]);
    expect(seen(folded)).not.toContain("home#title");
    expect(folded.flipped).toBe(NO_FOLDS.flipped);
  });

  it("forgets what was folded in it as the filter changes, and goes back to the panel's", () => {
    const folded = flip(NO_FOLDS, ["home#footer"]);
    const inFilter = flip(withQuery(folded, "o"), ["home#hero"]);
    expect(seen(withQuery(inFilter, "ow"))).toContain("home#title");
    expect(seen(withQuery(inFilter, ""))).toEqual([
      "home#page",
      "home#hero",
      "home#footer",
      "home#legal",
      "node:note#note",
    ]);
  });
});

describe("revealing the selection", () => {
  it("opens its page and the layers it is inside, but not the selected one", () => {
    const pageFolded = flip(NO_FOLDS, [pageKey("home")]);
    expect(seen(revealed(pageFolded, items, "home#title"))).toEqual([
      "home#page",
      "home#hero",
      "home#title",
      "home#cta",
      "home#footer",
      "node:note#note",
    ]);
    expect(seen(revealed(pageFolded, items, "home#hero"))).toEqual([
      "home#page",
      "home#hero",
      "home#footer",
      "node:note#note",
    ]);
  });

  it("opens a node on the canvas that the selected one is inside", () => {
    const card = looseItem(
      "node:card",
      column("card", [text("caption", "A caption")])
    );
    expect(
      seen(revealed(NO_FOLDS, [card], "node:card#caption"), [card])
    ).toEqual(["node:card#card", "node:card#caption"]);
  });

  it("leaves the folds as they are when the way down is open, or the row is not there", () => {
    expect(revealed(NO_FOLDS, items, "home#hero")).toBe(NO_FOLDS);
    expect(revealed(NO_FOLDS, items, "home#gone")).toBe(NO_FOLDS);
  });

  it("opens the rows folded among what a filter found", () => {
    const folded = flip(withQuery(NO_FOLDS, "o"), ["home#page", "home#hero"]);
    const shown = revealed(folded, items, "home#title");
    expect(seen(shown)).toContain("home#title");
    // Once the filter is cleared the way down is open too.
    expect(seen(withQuery(shown, ""))).toContain("home#title");
  });
});

describe("dropping a layer", () => {
  /** The page as above; on the canvas a note, and a card holding a caption. */
  const tree: LayerItem[] = [
    pageItem(page, root),
    looseItem("node:note", { ...text("note", "Remember"), x: 100, y: 200 }),
    looseItem("node:card", {
      ...column("card", [text("caption", "A caption")]),
      x: 400,
      y: 50,
    }),
  ];
  const row = (key: string) => findItem(tree, key) as LayerItem;
  const holds = (node: DesignNode) => node.type === "column";
  const positionsOver = (dragged: string, over: string) =>
    [0.1, 0.3, 0.5, 0.7, 0.9].map((y) =>
      dropPositionAt(row(dragged), row(over), y, holds)
    );

  it("refuses a layer onto itself or anything inside it", () => {
    expect(positionsOver("home#hero", "home#hero")).toEqual(
      new Array(5).fill(null)
    );
    expect(positionsOver("home#hero", "home#title")).toEqual(
      new Array(5).fill(null)
    );
    for (const position of ["before", "inside", "after"] as const) {
      expect(
        dropOf(tree, row("home#hero"), row("home#title"), position)
      ).toBeNull();
      expect(
        dropOf(tree, row("home#hero"), row("home#hero"), position)
      ).toBeNull();
    }
  });

  it("goes into a container over the middle of its row, else before or after it", () => {
    expect(positionsOver("home#title", "home#footer")).toEqual([
      "before",
      "before",
      "inside",
      "after",
      "after",
    ]);
    expect(positionsOver("home#title", "home#legal")).toEqual([
      "before",
      "before",
      "before",
      "after",
      "after",
    ]);
    expect(positionsOver("home#title", pageKey("home"))).toEqual(
      new Array(5).fill("inside")
    );
  });

  it("lands before or after a layer among its siblings, the dragged one left out, or inside at the top", () => {
    const drop = (dragged: string, over: string, position: DropPosition) =>
      dropOf(tree, row(dragged), row(over), position);
    expect(drop("home#title", "home#cta", "after")).toEqual({
      frame: "home",
      index: 1,
      kind: "into",
      parent: "hero",
    });
    expect(drop("home#title", "home#footer", "before")).toEqual({
      frame: "home",
      index: 1,
      kind: "into",
      parent: "root",
    });
    expect(drop("home#cta", "home#footer", "inside")).toEqual({
      frame: "home",
      index: 0,
      kind: "into",
      parent: "footer",
    });
  });

  it("puts a layer dropped on a page's row at the top of the page, in the view edited", () => {
    const inView = (frame: string) => (frame === "home" ? "home#md" : frame);
    expect(
      dropOf(
        tree,
        row("node:note#note"),
        row(pageKey("home")),
        "inside",
        inView
      )
    ).toEqual({ frame: "home#md", index: 0, kind: "into", parent: "root" });
    expect(
      dropOf(tree, row("node:note#note"), row(pageKey("home")), "after")
    ).toBeNull();
  });

  it("moves a page's layer onto the canvas 40px below the node it is dropped beside", () => {
    expect(
      dropOf(tree, row("home#hero"), row("node:note#note"), "after")
    ).toEqual({ at: { x: 100, y: 240 }, index: 1, kind: "canvas" });
    expect(
      dropOf(tree, row("home#hero"), row("node:card#card"), "before")
    ).toEqual({ at: { x: 400, y: 90 }, index: 1, kind: "canvas" });
  });

  it("reorders a node on the canvas among the others, leaving it where it is", () => {
    expect(
      dropOf(tree, row("node:note#note"), row("node:card#card"), "after")
    ).toEqual({ index: 1, kind: "canvas" });
  });

  it("gives a layer taken out of a node on the canvas a point below the one it is dropped beside", () => {
    expect(
      dropOf(tree, row("node:card#caption"), row("node:note#note"), "before")
    ).toEqual({ at: { x: 100, y: 240 }, index: 0, kind: "canvas" });
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
