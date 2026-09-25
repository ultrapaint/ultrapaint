import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { fillIds, makeIdGenerator } from "./ids.ts";
import { applyOps, cloneJson, DocumentOpError } from "./ops.ts";
import { canvasRoot, findNode, parentOf } from "./tree.ts";

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
        { component: "Button", from: "@ui/button", id: "b", type: "instance" },
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
    const group = parentOf(root, "free");
    expect(group).toMatchObject({ type: "group", x: 10, y: 20 });
    expect(findNode(root, "free")).not.toHaveProperty("x");
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
