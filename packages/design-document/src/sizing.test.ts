import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { fillWarnings } from "./sizing.ts";
import { CANVAS_ROOT_ID } from "./tree.ts";

const text = (id: string, fields: Partial<DesignNode> = {}): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text", ...fields }) as DesignNode;

const page = (children: DesignNode[]): DesignNode => ({
  children,
  id: "page",
  type: "page",
});

const warned = (root: DesignNode, instances = {}) =>
  fillWarnings(root, instances).map((w) => `${w.nodeId}.${w.axis}`);

describe("fillWarnings", () => {
  it("takes a page's own height as room to fill", () => {
    expect(warned(page([text("t", { height: "fill" })]))).toEqual([]);
  });

  it("finds a fill height in a column that hugs its content", () => {
    const root = page([
      {
        children: [text("t", { height: "fill", width: "fill" })],
        id: "c",
        type: "column",
      },
    ]);
    // Across the column, the width stretches; along it there is no room.
    expect(warned(root)).toEqual(["t.height"]);
  });

  it("lets a column with a height or a minimum share out its room", () => {
    const fixed = page([
      {
        children: [text("t", { height: "fill" })],
        height: 400,
        id: "c",
        type: "column",
      },
    ]);
    const min = page([
      {
        children: [text("t", { height: "fill" })],
        id: "c",
        minHeight: 400,
        type: "column",
      },
    ]);
    expect(warned(fixed)).toEqual([]);
    expect(warned(min)).toEqual([]);
  });

  it("finds a fill height in a group whose height is its content's", () => {
    const root = page([
      {
        children: [text("t", { height: "fill", width: "fill" })],
        id: "g",
        minHeight: 200,
        type: "group",
      },
    ]);
    // A group's width is the page's; a minimum is no base for a percentage.
    expect(warned(root)).toEqual(["t.height"]);
  });

  it("takes a group stretched across a row as sized", () => {
    const row = (crossAlign?: "center"): DesignNode =>
      page([
        {
          children: [
            text("side", { height: 300 }),
            {
              children: [text("t", { height: "fill" })],
              id: "g",
              type: "group",
            },
          ],
          crossAlign,
          id: "r",
          type: "row",
        },
      ]);
    expect(warned(row())).toEqual([]);
    expect(warned(row("center"))).toEqual(["t.height"]);
  });

  it("finds a fill width in a row that hugs", () => {
    const root = page([
      {
        children: [text("t", { width: "fill" })],
        id: "r",
        type: "row",
        width: "hug",
      },
    ]);
    expect(warned(root)).toEqual(["t.width"]);
  });

  it("reads a loose node on the canvas at its own size", () => {
    const canvas: DesignNode = {
      children: [
        {
          children: [text("a", { height: "fill" })],
          height: 709,
          id: "sized",
          type: "group",
        },
        {
          children: [text("b", { height: "fill" })],
          id: "loose",
          type: "group",
        },
      ],
      id: CANVAS_ROOT_ID,
      type: "group",
    };
    expect(warned(canvas)).toEqual(["b.height"]);
  });

  it("judges an instance's children by the layout its component was drawn with", () => {
    const root = page([
      {
        children: [text("t", { height: "fill" })],
        component: "Card",
        from: "@acme/ui",
        id: "card",
        type: "instance",
      },
    ]);
    expect(warned(root)).toEqual([]);
    expect(warned(root, { card: { layout: "block", wrapped: false } })).toEqual(
      ["t.height"]
    );
  });
});
