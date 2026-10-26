import type {
  DesignNode,
  InstanceNode,
  PageNode,
  StackNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { describeDiff, diffTrees, isEmptyDiff } from "./diff.ts";

const text = (id: string, value = id): TextNode => ({
  id,
  role: "paragraph",
  text: value,
  type: "text",
});

const column = (
  id: string,
  children: DesignNode[],
  name?: string
): StackNode => ({
  children,
  id,
  type: "column",
  ...(name && { name }),
});

const page = (children: DesignNode[]): PageNode => ({
  children,
  id: "root",
  type: "page",
});

const button = (fields: Partial<InstanceNode> = {}): InstanceNode => ({
  component: "Button",
  from: "@ui/button",
  id: "btn",
  type: "instance",
  ...fields,
});

const before = page([
  column("header", [text("title", "Title"), text("sub", "Subtitle")], "Header"),
  column("body", [text("a"), text("b"), text("c")], "Body"),
]);

describe("diffTrees", () => {
  it("finds nothing between a tree and itself, or a copy with keys in another order", () => {
    expect(isEmptyDiff(diffTrees(before, before))).toBe(true);
    const copy = JSON.parse(JSON.stringify(before)) as PageNode;
    const reordered: TextNode = {
      id: "x",
      role: "paragraph",
      text: "x",
      type: "text",
    };
    expect(isEmptyDiff(diffTrees(copy, before))).toBe(true);
    expect(isEmptyDiff(diffTrees(text("x"), reordered))).toBe(true);
  });

  it("lists an added subtree once, by its topmost node", () => {
    const card = column("card", [text("card-title"), text("card-body")]);
    const after = page([
      column(
        "header",
        [text("title", "Title"), text("sub", "Subtitle")],
        "Header"
      ),
      card,
      column("body", [text("a"), text("b"), text("c")], "Body"),
    ]);
    const diff = diffTrees(before, after);
    expect(diff.added).toEqual([
      {
        id: "card",
        index: 1,
        label: "Column",
        node: card,
        parent: "root",
        type: "column",
      },
    ]);
    expect(diff.removed).toEqual([]);
    expect(diff.moved).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("lists a removed subtree once, by its topmost node, in the order of the tree before", () => {
    const after = page([column("body", [text("a"), text("c")], "Body")]);
    const diff = diffTrees(before, after);
    expect(diff.removed).toEqual([
      { id: "header", label: "Header", parent: "root", type: "column" },
      { id: "b", label: "b", parent: "body", type: "text" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.moved).toEqual([]);
  });

  it("does not take siblings shifted by an insertion or a removal for moves", () => {
    const after = page([
      column(
        "header",
        [text("title", "Title"), text("sub", "Subtitle")],
        "Header"
      ),
      column("body", [text("new"), text("a"), text("c"), text("d")], "Body"),
    ]);
    const diff = diffTrees(before, after);
    expect(diff.moved).toEqual([]);
    expect(diff.added.map((a) => [a.id, a.index])).toEqual([
      ["new", 0],
      ["d", 3],
    ]);
    expect(diff.removed.map((r) => r.id)).toEqual(["b"]);
  });

  it("moves a node to another parent", () => {
    const after = page([
      column(
        "header",
        [text("title", "Title"), text("sub", "Subtitle"), text("b")],
        "Header"
      ),
      column("body", [text("a"), text("c")], "Body"),
    ]);
    const diff = diffTrees(before, after);
    expect(diff.moved).toEqual([
      {
        from: { index: 1, parent: "body" },
        id: "b",
        label: "b",
        to: { index: 2, parent: "header" },
        type: "text",
      },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("moves only the nodes out of order among the siblings both trees share", () => {
    const after = page([
      column(
        "header",
        [text("title", "Title"), text("sub", "Subtitle")],
        "Header"
      ),
      column("body", [text("c"), text("a"), text("b")], "Body"),
    ]);
    expect(diffTrees(before, after).moved).toEqual([
      {
        from: { index: 2, parent: "body" },
        id: "c",
        label: "c",
        to: { index: 0, parent: "body" },
        type: "text",
      },
    ]);
  });

  it("reports one of two swapped siblings", () => {
    const after = page([
      column("body", [text("a"), text("b"), text("c")], "Body"),
      column(
        "header",
        [text("title", "Title"), text("sub", "Subtitle")],
        "Header"
      ),
    ]);
    expect(diffTrees(before, after).moved).toHaveLength(1);
  });

  it("moves nodes out of a removed parent into an added one", () => {
    const after = page([
      column(
        "header",
        [text("title", "Title"), text("sub", "Subtitle")],
        "Header"
      ),
      column("main", [text("a"), text("b"), text("c")], "Main"),
    ]);
    const diff = diffTrees(before, after);
    expect(diff.added.map((a) => a.id)).toEqual(["main"]);
    expect(diff.removed.map((r) => r.id)).toEqual(["body"]);
    expect(diff.moved.map((m) => [m.id, m.from.parent, m.to.parent])).toEqual([
      ["a", "body", "main"],
      ["b", "body", "main"],
      ["c", "body", "main"],
    ]);
    expect(diff.parents.body).toEqual({
      id: "body",
      label: "Body",
      type: "column",
    });
  });

  it("compares a node's own fields, nested values whole, children aside", () => {
    const old = page([
      button({ props: { size: "sm", variant: "default" }, text: "Save" }),
    ]);
    const changed = page([
      button({
        fill: "$color-primary",
        padding: { left: 4 },
        props: { size: "sm", variant: "outline" },
        text: "Save",
      }),
    ]);
    const diff = diffTrees(old, changed);
    expect(diff.changed).toEqual([
      {
        fields: [
          { after: "$color-primary", before: undefined, field: "fill" },
          { after: { left: 4 }, before: undefined, field: "padding" },
          {
            after: { size: "sm", variant: "outline" },
            before: { size: "sm", variant: "default" },
            field: "props",
          },
        ],
        id: "btn",
        label: 'Button "Save"',
        type: "instance",
      },
    ]);
  });

  it("reports a field removed, and a type changed, as changes of the node", () => {
    const old = page([{ ...text("t"), color: "$color-muted" }]);
    const after = page([text("t")]);
    expect(diffTrees(old, after).changed[0]?.fields).toEqual([
      { after: undefined, before: "$color-muted", field: "color" },
    ]);
    const asRow = diffTrees(column("s", [text("x")]), {
      ...column("s", [text("x")]),
      type: "row",
    });
    expect(asRow.changed[0]?.fields).toEqual([
      { after: "row", before: "column", field: "type" },
    ]);
    expect(asRow.moved).toEqual([]);
  });

  it("does not count a change inside a child as a change of its parent", () => {
    const after = page([
      column(
        "header",
        [text("title", "New title"), text("sub", "Subtitle")],
        "Header"
      ),
      column("body", [text("a"), text("b"), text("c")], "Body"),
    ]);
    expect(diffTrees(before, after).changed.map((c) => c.id)).toEqual([
      "title",
    ]);
  });

  it("compares the root's fields, and a root replaced is one removed and one added", () => {
    const wider: PageNode = { ...before, gap: 8, width: 1440 };
    expect(diffTrees(before, wider).changed).toEqual([
      {
        fields: [
          { after: 8, before: undefined, field: "gap" },
          { after: 1440, before: undefined, field: "width" },
        ],
        id: "root",
        label: "Page",
        type: "page",
      },
    ]);
    const other: PageNode = { children: [], id: "root-2", type: "page" };
    const diff = diffTrees(before, other);
    expect(diff.added.map((a) => [a.id, a.parent])).toEqual([["root-2", null]]);
    expect(diff.removed.map((r) => [r.id, r.parent])).toEqual([["root", null]]);
  });

  it("sees into an instance's slot", () => {
    const old = page([button({ children: [text("icon"), text("label")] })]);
    const after = page([button({ children: [text("label"), text("icon")] })]);
    expect(diffTrees(old, after).moved.map((m) => m.id)).toHaveLength(1);
    expect(diffTrees(old, after).changed).toEqual([]);
  });

  it("orders entries as the tree after does", () => {
    const after = page([
      column("body", [text("c", "C"), text("a"), text("b")], "Body"),
      column(
        "header",
        [text("sub", "Sub"), text("title", "Title"), text("x")],
        "Header"
      ),
    ]);
    const diff = diffTrees(before, after);
    expect(diff.changed.map((c) => c.id)).toEqual(["c", "sub"]);
    expect(diff.moved.map((m) => m.id)).toEqual(["body", "c", "sub"]);
  });
});

describe("describeDiff", () => {
  it("says so when nothing changed", () => {
    expect(describeDiff(diffTrees(before, before))).toBe("No changes.");
  });

  it("writes a line per entry: added, removed, moved, then changed", () => {
    const after = page([
      column(
        "header",
        [text("eyebrow", "New"), text("title", "Title"), text("c")],
        "Header"
      ),
      column("body", [text("b"), text("a")], "Body"),
      button({ props: { variant: "outline" } }),
    ]);
    const withButton = page([
      ...before.children,
      button({ props: { variant: "default" } }),
    ]);
    expect(describeDiff(diffTrees(withButton, after))).toBe(
      [
        '- added text "New" (eyebrow) in column "Header" (header) at 0',
        '- removed text "Subtitle" (sub) from column "Header" (header)',
        '- moved text "c" (c) from column "Body" (body) at 2 to column "Header" (header) at 2',
        '- moved text "b" (b) within column "Body" (body) from 1 to 0',
        '- changed instance "Button" (btn): props {"variant":"default"} → {"variant":"outline"}',
      ].join("\n")
    );
  });

  it("writes an unset value as (none) and joins a node's fields", () => {
    const after = page([button({ fill: "$color-primary", opacity: 0.5 })]);
    expect(describeDiff(diffTrees(page([button()]), after))).toBe(
      '- changed instance "Button" (btn): fill (none) → "$color-primary"; opacity (none) → 0.5'
    );
  });

  it("names a replaced root as such", () => {
    const other: PageNode = { children: [], id: "root-2", type: "page" };
    expect(describeDiff(diffTrees(page([]), other))).toBe(
      [
        '- added page "Page" (root-2) as the root',
        '- removed page "Page" (root), the root',
      ].join("\n")
    );
  });
});

describe("diffTrees at breakpoints", () => {
  it("names what a breakpoint sets as a field of its own", () => {
    const then: DesignNode = {
      at: { md: { gap: 24 } },
      children: [],
      gap: 16,
      id: "s",
      type: "column",
    };
    const now: DesignNode = {
      at: { lg: { gap: 32 }, md: { gap: 24, type: "row" } },
      children: [],
      gap: 16,
      id: "s",
      type: "column",
    };
    expect(diffTrees(then, now).changed[0]?.fields).toEqual([
      { after: 32, before: undefined, field: "at.lg.gap" },
      { after: "row", before: undefined, field: "at.md.type" },
    ]);
  });
});
