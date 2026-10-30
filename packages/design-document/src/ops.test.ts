import type {
  DesignNode,
  DocOp,
  InstanceNode,
  PageNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { fillIds, makeIdGenerator } from "./ids.ts";
import { applyOps, cloneJson, DocumentOpError, touchedBy } from "./ops.ts";
import { canvasRoot, findNode, findPath } from "./tree.ts";

const text = (id: string, value = id): DesignNode => ({
  id,
  role: "paragraph",
  text: value,
  type: "text",
});

const page = (): PageNode => ({
  children: [
    {
      children: [text("a"), text("b"), text("c")],
      id: "row",
      type: "row",
    },
    text("d"),
  ],
  id: "root",
  type: "page",
});

const ids = (node: DesignNode | null) =>
  node && "children" in node ? (node.children ?? []).map((c) => c.id) : [];

const card = (
  children?: DesignNode[],
  id = "card",
  words?: string
): InstanceNode => ({
  component: "Card",
  from: "@ultrapaint/system",
  id,
  type: "instance",
  ...(children && { children }),
  ...(words !== undefined && { text: words }),
});

const options = () => ({ canvas: false, next: makeIdGenerator(["root"]) });

describe("applyOps", () => {
  it("inserts at an index and at the end, keeping the given id", () => {
    const { created, root } = applyOps(
      page(),
      [
        { index: 1, node: text("x"), op: "insert", parent: "row" },
        { node: text("y"), op: "insert", parent: null },
      ],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["a", "x", "b", "c"]);
    expect(ids(root)).toEqual(["row", "d", "y"]);
    expect(created).toEqual(["x", "y"]);
  });

  it("gives an inserted tree new ids when one is taken", () => {
    const { created, root } = applyOps(
      page(),
      [{ node: text("a"), op: "insert", parent: null }],
      options()
    );
    expect(created[0]).not.toBe("a");
    expect(findNode(root, created[0] as string)).not.toBeNull();
  });

  it("moves within a parent counting siblings without the moved node", () => {
    const { root } = applyOps(
      page(),
      [{ id: "a", index: 2, op: "move", parent: "row" }],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["b", "c", "a"]);
  });

  it("moves across parents and refuses a move into itself", () => {
    const { root } = applyOps(
      page(),
      [{ id: "d", index: 0, op: "move", parent: "row" }],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["d", "a", "b", "c"]);
    expect(() =>
      applyOps(page(), [{ id: "row", op: "move", parent: "row" }], options())
    ).toThrow(DocumentOpError);
  });

  it("updates fields, removes them with null, and guards the structure", () => {
    const { root } = applyOps(
      page(),
      [
        { id: "row", op: "update", set: { gap: 12, type: "column" } },
        { id: "row", op: "update", set: { gap: null } },
      ],
      options()
    );
    const row = findNode(root, "row");
    expect(row?.type).toBe("column");
    expect(row && "gap" in row).toBe(false);
    expect(() =>
      applyOps(
        page(),
        [{ id: "a", op: "update", set: { type: "row" } }],
        options()
      )
    ).toThrow(DocumentOpError);
    expect(() =>
      applyOps(page(), [{ id: "a", op: "update", set: { id: "z" } }], options())
    ).toThrow(DocumentOpError);
  });

  it("wraps siblings in place and unwraps them back", () => {
    const wrapped = applyOps(
      page(),
      [{ ids: ["c", "b"], op: "wrap", type: "column" }],
      options()
    );
    const column = wrapped.created[0] as string;
    expect(ids(findNode(wrapped.root, "row"))).toEqual(["a", column]);
    expect(ids(findNode(wrapped.root, column))).toEqual(["b", "c"]);
    const unwrapped = applyOps(
      wrapped.root,
      [{ id: column, op: "unwrap" }],
      options()
    );
    expect(ids(findNode(unwrapped.root, "row"))).toEqual(["a", "b", "c"]);
    expect(() =>
      applyOps(
        page(),
        [{ ids: ["a", "d"], op: "wrap", type: "row" }],
        options()
      )
    ).toThrow(DocumentOpError);
  });

  it("replaces nodes in place, siblings, keeping an id of one it replaces", () => {
    const { created, root } = applyOps(
      page(),
      [{ ids: ["b", "c"], node: card(undefined, "b"), op: "replace" }],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["a", "b"]);
    expect(findNode(root, "b")).toMatchObject({ type: "instance" });
    expect(created).toEqual(["b"]);
    expect(() =>
      applyOps(
        page(),
        [{ ids: ["a", "d"], node: text("x"), op: "replace" }],
        options()
      )
    ).toThrow(DocumentOpError);
  });

  it("replaces a node on the canvas at its position, unless the node gives its own", () => {
    const canvas = canvasRoot([{ ...text("free"), x: 10, y: 20 }]);
    const opts = { canvas: true, next: makeIdGenerator() };
    const { root } = applyOps(
      canvas,
      [{ ids: ["free"], node: card(undefined, "free"), op: "replace" }],
      opts
    );
    expect(findNode(root, "free")).toMatchObject({
      type: "instance",
      x: 10,
      y: 20,
    });
  });

  it("duplicates with new ids right after the original", () => {
    const { created, root } = applyOps(
      page(),
      [{ id: "row", op: "duplicate" }],
      options()
    );
    const copy = created[0] as string;
    expect(ids(root)).toEqual(["row", copy, "d"]);
    expect(ids(findNode(root, copy))).not.toContain("a");
  });

  it("sets and clears instance props", () => {
    const start: PageNode = {
      children: [
        {
          component: "Button",
          from: "@ultrapaint/system",
          id: "b",
          type: "instance",
        },
      ],
      id: "root",
      type: "page",
    };
    const set = applyOps(
      start,
      [{ id: "b", op: "setProps", props: { size: "sm", variant: "ghost" } }],
      options()
    );
    const cleared = applyOps(
      set.root,
      [{ id: "b", op: "setProps", props: { size: null, variant: null } }],
      options()
    );
    expect(findNode(set.root, "b")).toMatchObject({
      props: { size: "sm", variant: "ghost" },
    });
    expect(findNode(cleared.root, "b")).not.toHaveProperty("props");
    expect(() =>
      applyOps(page(), [{ id: "a", op: "setProps", props: {} }], options())
    ).toThrow(DocumentOpError);
  });

  it("positions the canvas's top-level nodes and nothing inside them", () => {
    const canvas = canvasRoot([{ ...text("free"), x: 10.4, y: 20 }]);
    const opts = { canvas: true, next: makeIdGenerator() };
    const { root } = applyOps(
      canvas,
      [
        { node: text("new"), op: "insert", parent: null },
        { ids: ["free"], op: "wrap", type: "group" },
      ],
      opts
    );
    expect(findNode(root, "new")).toMatchObject({ x: 0, y: 0 });
    const group = findPath(root, "free")?.at(-2);
    expect(group).toMatchObject({ type: "group", x: 10, y: 20 });
    expect(findNode(root, "free")).not.toHaveProperty("x");
  });

  it("moves a node into an instance and back out", () => {
    const withCard: PageNode = {
      ...page(),
      children: [...page().children, card([text("title")])],
    };
    const into = applyOps(
      withCard,
      [{ id: "d", index: 0, op: "move", parent: "card" }],
      options()
    ).root;
    expect(ids(findNode(into, "card"))).toEqual(["d", "title"]);
    const out = applyOps(
      into,
      [{ id: "d", op: "move", parent: "root" }],
      options()
    ).root;
    // Left with its one plain text, the card shows it as its own text again.
    expect(findNode(out, "card")).toEqual(card(undefined, "card", "title"));
    expect(ids(out)).toEqual(["row", "card", "d"]);
  });

  it("turns an instance's text into its first child when a node arrives", () => {
    const withCard: PageNode = {
      ...page(),
      children: [...page().children, card(undefined, "card", "Card")],
    };
    const { created, root } = applyOps(
      withCard,
      [{ id: "d", index: 0, op: "move", parent: "card" }],
      options()
    );
    const node = findNode(root, "card");
    const [first, second] =
      node?.type === "instance" ? (node.children ?? []) : [];
    expect(node && "text" in node).toBe(false);
    expect(first).toMatchObject({
      role: "paragraph",
      text: "Card",
      type: "text",
    });
    expect(second?.id).toBe("d");
    expect(created).toEqual([]);
  });

  it("keeps an instance's text as a child when something is inserted into it", () => {
    const withCard: PageNode = {
      ...page(),
      children: [card(undefined, "card", "Save")],
    };
    const { created, root } = applyOps(
      withCard,
      [{ node: text("icon"), op: "insert", parent: "card" }],
      options()
    );
    const node = findNode(root, "card");
    expect(ids(node).at(-1)).toBe("icon");
    expect(ids(node)).toHaveLength(2);
    expect(created).toEqual(["icon"]);
  });

  it("gives an instance its text back when what came in goes out again", () => {
    const withCard: PageNode = {
      ...page(),
      children: [...page().children, card(undefined, "card", "Card")],
    };
    const into = applyOps(
      withCard,
      [{ id: "d", op: "move", parent: "card" }],
      options()
    ).root;
    const out = applyOps(
      into,
      [{ id: "d", op: "move", parent: "root" }],
      options()
    ).root;
    expect(findNode(out, "card")).toEqual(card(undefined, "card", "Card"));
    const removed = applyOps(into, [{ id: "d", op: "remove" }], options());
    expect(findNode(removed.root, "card")).toEqual(
      card(undefined, "card", "Card")
    );
  });

  it("keeps a text node that was styled, or that stays among others", () => {
    const styled: PageNode = {
      ...page(),
      children: [
        card([{ ...(text("words") as TextNode), weight: 600 }, text("icon")]),
        text("d"),
      ],
    };
    const { root } = applyOps(
      styled,
      [{ id: "icon", op: "remove" }],
      options()
    );
    expect(ids(findNode(root, "card"))).toEqual(["words"]);
    const reordered = applyOps(
      { ...page(), children: [card([text("words"), text("icon")])] },
      [{ id: "icon", index: 0, op: "move", parent: "card" }],
      options()
    ).root;
    expect(ids(findNode(reordered, "card"))).toEqual(["icon", "words"]);
  });

  it("refuses to move an instance into what it holds", () => {
    const nested: PageNode = {
      ...page(),
      children: [card([card([], "inner")])],
    };
    expect(() =>
      applyOps(nested, [{ id: "card", op: "move", parent: "inner" }], options())
    ).toThrow(DocumentOpError);
  });

  it("leaves the input untouched", () => {
    const before = page();
    const copy = cloneJson(before);
    applyOps(before, [{ id: "a", op: "remove" }], options());
    expect(before).toEqual(copy);
  });
});

describe("fillIds", () => {
  it("fills missing and repeated ids in raw JSON", () => {
    const raw = {
      root: {
        children: [
          { role: "paragraph", text: "x", type: "text" },
          { id: "same", role: "paragraph", text: "y", type: "text" },
          { id: "same", role: "paragraph", text: "z", type: "text" },
        ],
        id: "root",
        type: "page",
      },
      version: 1,
    };
    expect(fillIds(raw)).toBe(true);
    const got = raw.root.children.map((c) => (c as { id?: string }).id);
    expect(new Set(got).size).toBe(3);
    expect(got[1]).toBe("same");
    expect(fillIds(raw)).toBe(false);
  });
});

describe("touchedBy", () => {
  it("names what was set, moved or made, not what was removed or the root", () => {
    const before: DesignNode = {
      children: [
        { id: "a", role: "paragraph", text: "A", type: "text" },
        { id: "b", role: "paragraph", text: "B", type: "text" },
        { id: "c", role: "paragraph", text: "C", type: "text" },
      ],
      id: "root",
      type: "page",
    };
    const ops: DocOp[] = [
      { id: "a", op: "update", set: { text: "A!" } },
      { id: "b", op: "remove" },
      { id: "c", index: 0, op: "move", parent: null },
      { id: "root", op: "update", set: { gap: 8 } },
    ];
    const { root } = applyOps(before, ops, {
      canvas: false,
      next: () => "x_1",
    });
    expect(touchedBy(ops, [], root).sort()).toEqual(["a", "c"]);
  });
});
