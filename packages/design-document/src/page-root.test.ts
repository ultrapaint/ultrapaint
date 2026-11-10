import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { applyOps } from "./ops.ts";
import { foldOps, wrapperOf, wrapperWarning } from "./page-root.ts";

const WARNED = /^c_1: the page is the screen's container/;

const text = (id: string): DesignNode => ({
  id,
  role: "paragraph",
  text: id,
  type: "text",
});

const page = (
  child: DesignNode,
  fields: Record<string, unknown> = {}
): DesignNode =>
  ({
    children: [child],
    fill: "$color-background",
    gap: 0,
    id: "root",
    type: "page",
    ...fields,
  }) as DesignNode;

const folded = (root: DesignNode, screenHeight?: number) => {
  const ops = foldOps(root, screenHeight);
  if (!ops) {
    return null;
  }
  return applyOps(root, ops, { canvas: false, next: () => "x" }).root;
};

describe("folding a page's wrapper into its root", () => {
  it("lifts a screen-tall row onto the root, as its direction", () => {
    const root = page({
      children: [text("side"), text("main")],
      crossAlign: "stretch",
      fill: "#111",
      height: 900,
      id: "r_1",
      name: "Editor",
      padding: 8,
      type: "row",
      width: "fill",
    });
    expect(folded(root, 900)).toEqual({
      children: [text("side"), text("main")],
      crossAlign: "stretch",
      direction: "row",
      fill: "#111",
      id: "root",
      padding: 8,
      type: "page",
    });
  });

  it("keeps a height other than the screen's as the page's minimum", () => {
    const root = page({
      children: [text("a")],
      height: 1200,
      id: "r_1",
      type: "row",
      width: "fill",
    });
    expect(folded(root, 900)).toMatchObject({ minHeight: 1200 });
  });

  it("drops the align of a column as tall as its content, which had no room to align in", () => {
    const root = page({
      align: "center",
      children: [text("a")],
      id: "c_1",
      padding: 40,
      type: "column",
      width: "fill",
    });
    const after = folded(root);
    expect(after).toMatchObject({ fill: "$color-background", padding: 40 });
    expect(after).not.toHaveProperty("align");
    expect(after).not.toHaveProperty("direction");
  });

  it("takes the child's breakpoints, its type as the root's direction", () => {
    const root = page({
      at: { md: { gap: 24, type: "row" } },
      children: [text("a")],
      height: "fill",
      id: "c_1",
      type: "column",
    });
    expect(folded(root)).toMatchObject({
      at: { md: { direction: "row", gap: 24 } },
    });
  });

  it("leaves a page alone when folding would lose something", () => {
    const narrow = page({
      children: [],
      id: "c_1",
      maxWidth: 640,
      type: "column",
    });
    const hugRow = page({ children: [], id: "r_1", type: "row" });
    const padded = page(
      { children: [], id: "c_1", type: "column" },
      { padding: 24 }
    );
    const notAStack = page(text("t"));
    for (const root of [narrow, hugRow, padded, notAStack]) {
      expect(foldOps(root, 900)).toBeNull();
    }
    expect(wrapperOf(narrow)).toBeNull();
  });

  it("warns of a wrapper, naming it", () => {
    const root = page({
      children: [],
      height: "fill",
      id: "c_1",
      type: "column",
      width: "fill",
    });
    expect(wrapperWarning(root)).toMatch(WARNED);
    expect(wrapperWarning(page(text("t")))).toBeNull();
  });
});
