import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { makeStyleContext, nodeStyle, runsInRow, tagOf } from "./css.ts";

const ds = {
  ...emptyDesignSystem(),
  colors: [
    { name: "Semantic", tokens: [{ name: "color-primary", value: "#123456" }] },
  ],
  typography: {
    fonts: [],
    sizes: [{ lineHeight: "1.75rem", name: "text-lg", value: "1.125rem" }],
    styles: [
      {
        name: "Title",
        role: "heading" as const,
        size: "$text-lg",
        weight: 700,
      },
    ],
    weights: [],
  },
};

describe("nodeStyle", () => {
  it("draws tokens as their variables with the recorded value as fallback", () => {
    const node: DesignNode = {
      children: [],
      fill: "$color-primary",
      gap: "$spacing-4",
      id: "r",
      padding: { left: 8, top: 4 },
      type: "row",
    };
    expect(nodeStyle(node, makeStyleContext(ds))).toMatchObject({
      background: "var(--color-primary, #123456)",
      display: "flex",
      flexDirection: "row",
      gap: "calc(var(--spacing, 0.25rem) * 4)",
      paddingLeft: "8px",
      paddingTop: "4px",
    });
  });

  it("fills along the main axis and stretches across it", () => {
    const node: DesignNode = {
      children: [],
      height: "fill",
      id: "g",
      type: "group",
      width: "fill",
    };
    expect(nodeStyle(node, makeStyleContext(ds, "row"))).toMatchObject({
      alignSelf: "stretch",
      flexGrow: "1",
      minWidth: "0",
    });
    expect(nodeStyle(node, makeStyleContext(ds, "block"))).toMatchObject({
      height: "100%",
      width: "100%",
    });
  });

  it("sets text in its style and lets the node override it", () => {
    const node: DesignNode = {
      id: "t",
      level: 2,
      role: "heading",
      text: "Hi",
      textStyle: "Title",
      type: "text",
      weight: 500,
    };
    expect(nodeStyle(node, makeStyleContext(ds))).toMatchObject({
      fontSize: "var(--text-lg, 1.125rem)",
      fontWeight: "500",
      lineHeight: "var(--text-lg--line-height, 1.75rem)",
      margin: "0",
    });
    expect(tagOf(node)).toBe("h2");
  });
});

describe("runsInRow", () => {
  const group: DesignNode = { children: [], id: "g", type: "group" };
  const box = (x: number, y: number) => ({ height: 20, width: 40, x, y });

  it("takes a row's and a column's word for it", () => {
    expect(runsInRow({ ...group, type: "row" }, [])).toBe(true);
    expect(
      runsInRow({ ...group, type: "column" }, [box(0, 0), box(50, 0)])
    ).toBe(false);
  });

  it("reads the rest off where the children are drawn", () => {
    expect(runsInRow(group, [box(0, 0), box(50, 0)])).toBe(true);
    expect(runsInRow(group, [box(0, 0), box(0, 30)])).toBe(false);
    expect(runsInRow(group, [null, box(0, 0), box(50, 2)])).toBe(true);
  });

  it("stacks what it cannot tell", () => {
    expect(runsInRow(group, [box(0, 0)])).toBe(false);
  });
});
