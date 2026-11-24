import type {
  DesignNode,
  DocOp,
  PageNode,
} from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { makeIdGenerator } from "./ids.ts";
import { inertFields } from "./inert-fields.ts";
import { applyOps } from "./ops.ts";
import { childrenOf, findNode } from "./tree.ts";

const text = (id: string): DesignNode => ({
  id,
  role: "paragraph",
  text: id,
  type: "text",
});

const page = (): PageNode => ({
  children: [
    { children: [text("a")], gap: 4, id: "row", type: "row" },
    { children: [text("b"), text("c")], id: "group", type: "group" },
    {
      component: "Shell",
      from: "#app",
      id: "shell",
      overrides: { title: { color: "red" } },
      type: "instance",
    },
  ],
  id: "root",
  type: "page",
});

/** The design system's breakpoints, smallest first. */
const BREAKPOINTS = ["sm", "md", "lg"];

/** The fields the operations set that did nothing, on the page as they leave it. */
const inert = (
  ops: DocOp[],
  kindOf?: (layer: string) => string | undefined
) => {
  const { found, root } = applyOps(page(), ops, {
    canvas: false,
    next: makeIdGenerator(["root"]),
    ...(kindOf && { kindOf }),
  });
  return inertFields(found, root, BREAKPOINTS);
};

/** The fields named, without why. */
const named = (ops: DocOp[], kindOf?: (layer: string) => string) =>
  inert(ops, kindOf).map(({ field, id }) => `${id}.${field}`);

describe("inertFields", () => {
  it("names a field the node's type does not have, its own and at a breakpoint", () => {
    expect(
      inert([{ id: "group", op: "update", set: { fill: "#fff", gap: 8 } }])
    ).toEqual([{ field: "gap", id: "group", why: "a group has no gap" }]);
    expect(
      inert([{ at: "md", id: "b", op: "update", set: { gap: 8, size: 20 } }])
    ).toEqual([{ field: "at.md.gap", id: "b", why: "a text has no gap" }]);
  });

  it("names a field an instance's layer does not have, by its kind as its main component draws it", () => {
    expect(
      inert(
        [{ id: "shell/title", op: "update", set: { color: "blue", gap: 8 } }],
        (layer) => (layer === "shell/title" ? "text" : undefined)
      )
    ).toEqual([
      { field: "gap", id: "shell/title", why: "a text layer has no gap" },
    ]);
  });

  it("names a gap or a wrap on a stack holding one node or none, as the call leaves it", () => {
    expect(
      inert([{ id: "row", op: "update", set: { gap: 8, wrap: true } }])
    ).toEqual([
      { field: "gap", id: "row", why: "the row holds one node: gap needs two" },
      {
        field: "wrap",
        id: "row",
        why: "the row holds one node: wrap needs two",
      },
    ]);
    expect(
      named([
        { id: "row", op: "update", set: { gap: 8 } },
        { node: text("x"), op: "insert", parent: "row" },
      ])
    ).toEqual([]);
  });

  it("names a breakpoint's value that is the node's own", () => {
    expect(
      inert([{ at: "md", id: "row", op: "update", set: { gap: 4 } }])
    ).toContainEqual({
      field: "at.md.gap",
      id: "row",
      why: "the same as its own gap",
    });
  });

  it("names no breakpoint value equal to the node's own that brings it back above a smaller breakpoint's", () => {
    expect(
      named([
        { id: "b", op: "update", set: { size: 20 } },
        { at: "sm", id: "b", op: "update", set: { size: 16 } },
        { at: "md", id: "b", op: "update", set: { size: 20 } },
      ])
    ).toEqual([]);
  });

  it("names a breakpoint value equal to the node's own however a larger breakpoint sets it", () => {
    expect(
      named([
        { id: "b", op: "update", set: { size: 20 } },
        { at: "lg", id: "b", op: "update", set: { size: 32 } },
        { at: "md", id: "b", op: "update", set: { size: 20 } },
      ])
    ).toEqual(["b.at.md.size"]);
  });

  it("names a value the node already had, and a null on a field it did not have", () => {
    expect(
      inert([{ id: "b", op: "update", set: { fill: null, text: "b" } }])
    ).toEqual([
      { field: "fill", id: "b", why: "it has no fill to take off" },
      { field: "text", id: "b", why: "already set to that" },
    ]);
  });

  it("judges each value against the node as its operation found it", () => {
    expect(
      named([
        { id: "b", op: "update", set: { size: 8 } },
        { id: "b", op: "update", set: { size: 8 } },
      ])
    ).toEqual(["b.size"]);
    expect(
      named([
        { id: "b", op: "update", set: { text: "B" } },
        { id: "b", op: "update", set: { text: "b" } },
      ])
    ).toEqual([]);
  });

  it("names nothing for a change that took, nor a field the page held that the call did not set", () => {
    expect(
      named([
        { id: "row", op: "update", set: { fill: "#fff" } },
        { at: "md", id: "b", op: "update", set: { size: 20 } },
      ])
    ).toEqual([]);
  });

  it("names the fields of an inserted or replacing tree by the ids they have on the page", () => {
    const tree = (id: string): DesignNode =>
      ({
        children: [
          {
            children: [text(`${id}-t`)],
            gap: 8,
            id: `${id}-col`,
            type: "column",
          },
        ],
        gap: 8,
        id,
        type: "group",
      }) as DesignNode;
    const { created, found, root } = applyOps(
      page(),
      [
        { node: tree("group"), op: "insert", parent: null },
        { ids: ["row"], node: tree("fresh"), op: "replace" },
      ],
      { canvas: false, next: makeIdGenerator(["root"]) }
    );
    const [copy = "", fresh = ""] = created;
    expect(copy).not.toBe("group");
    const [column] = childrenOf(findNode(root, copy) as DesignNode);
    expect(inertFields(found, root, BREAKPOINTS)).toEqual([
      { field: "gap", id: copy, why: "a group has no gap" },
      {
        field: "gap",
        id: column?.id,
        why: "the column holds one node: gap needs two",
      },
      { field: "gap", id: fresh, why: "a group has no gap" },
      {
        field: "gap",
        id: "fresh-col",
        why: "the column holds one node: gap needs two",
      },
    ]);
  });

  /** What the nodes put in at the top of the page set that did nothing. */
  const insertedInert = (node: DesignNode) => {
    const { found, root } = applyOps(
      page(),
      [{ node, op: "insert", parent: null }],
      { canvas: false, next: makeIdGenerator(["root"]) }
    );
    return inertFields(found, root, BREAKPOINTS);
  };

  it("names children on a node put in that holds none", () => {
    expect(
      insertedInert({ ...text("leaf"), children: [] } as unknown as DesignNode)
    ).toEqual([
      { field: "children", id: "leaf", why: "a text has no children" },
    ]);
  });

  it("names a breakpoint's value of a node put in that is its own", () => {
    expect(
      insertedInert({
        at: { md: { gap: 8 } },
        children: [text("x"), text("y")],
        gap: 8,
        id: "pair",
        type: "row",
      })
    ).toEqual([
      { field: "at.md.gap", id: "pair", why: "the same as its own gap" },
    ]);
  });

  it("names a layer's breakpoint value that is its instance override's own", () => {
    expect(
      inert([
        { at: "md", id: "shell/title", op: "update", set: { color: "red" } },
      ])
    ).toEqual([
      {
        field: "at.md.color",
        id: "shell/title",
        why: "the same as its own color",
      },
    ]);
  });
});
