import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  baseStyle,
  declarationsOf,
  makeStyleContext,
  nodeStyle,
  pageDefaultsStyle,
  runsInRow,
  tagOf,
} from "./css.ts";

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

  it("puts margin outside the node, side by side as padding", () => {
    const node: DesignNode = {
      children: [],
      id: "r",
      margin: { left: 8, top: "$spacing-2" },
      type: "row",
    };
    expect(nodeStyle(node, makeStyleContext(ds))).toMatchObject({
      marginLeft: "8px",
      marginTop: "calc(var(--spacing, 0.25rem) * 2)",
    });
    expect(
      nodeStyle({ ...node, margin: 12 }, makeStyleContext(ds))
    ).toMatchObject({ margin: "12px" });
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

describe("declarationsOf", () => {
  it("says a node's look as CSS, tokens kept by name and pixels as numbers", () => {
    const node: DesignNode = {
      children: [],
      fill: "$color-primary",
      gap: "$spacing-4",
      id: "r",
      padding: { left: 8, top: 4 },
      type: "row",
      width: "hug",
    };
    expect(declarationsOf(node, makeStyleContext(ds, "row"))).toEqual({
      background: "$color-primary",
      display: "flex",
      flexDirection: "row",
      flexGrow: "0",
      flexShrink: "0",
      gap: "$spacing-4",
      paddingLeft: 8,
      paddingTop: 4,
      width: "fit-content",
    });
  });

  it("sets a text in its style, a token's size with the line height it is paired with", () => {
    const node: DesignNode = {
      id: "t",
      role: "heading",
      text: "Two\nlines",
      textStyle: "Title",
      type: "text",
    };
    expect(declarationsOf(node, makeStyleContext(ds))).toEqual({
      fontSize: "$text-lg",
      fontWeight: "700",
      lineHeight: "$text-lg--line-height",
      whiteSpace: "pre-wrap",
    });
  });

  it("keeps a node's own minimum over the one a fill sets", () => {
    const node: DesignNode = {
      children: [],
      id: "g",
      minWidth: 26,
      type: "group",
      width: "fill",
    };
    expect(declarationsOf(node, makeStyleContext(ds, "row"))).toMatchObject({
      flexGrow: "1",
      minWidth: 26,
    });
  });

  it("is what the canvas draws, over what it draws besides", () => {
    const page: DesignNode = { children: [], id: "p", type: "page" };
    const ctx = makeStyleContext(ds);
    expect(declarationsOf(page, ctx).minHeight).toBe("100vh");
    // In its frame, the screen is the frame.
    expect(nodeStyle(page, ctx)).toEqual({
      ...baseStyle(page),
      display: "flex",
      flexDirection: "column",
      minHeight: "100%",
    });
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

describe("pageDefaultsStyle", () => {
  it("draws a canvas's pages in its fill, colour and type, tokens as variables", () => {
    expect(
      pageDefaultsStyle(
        {
          color: "$color-foreground",
          fill: "$color-background",
          font: "$font-sans",
          size: "$text-sm",
        },
        makeStyleContext(null)
      )
    ).toEqual({
      background: "var(--color-background)",
      color: "var(--color-foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      // A Tailwind size brings the line height it is paired with.
      lineHeight: "var(--text-sm--line-height)",
    });
  });

  it("leaves to the stylesheet what the canvas does not say", () => {
    expect(
      pageDefaultsStyle({ theme: "dark" }, makeStyleContext(null))
    ).toEqual({});
  });
});

describe("a tinted image", () => {
  it("is its file's shape filled with the tint", () => {
    const style = nodeStyle(
      {
        height: 16,
        id: "i",
        src: "assets/icons/check.svg",
        tint: "$color-muted",
        type: "image",
        width: 16,
      },
      makeStyleContext(null)
    );
    expect(style.background).toBe("var(--color-muted)");
    expect(style.maskSize).toBe("contain");
    expect(style.objectFit).toBeUndefined();
    expect(tagOf({ id: "i", src: "x.svg", tint: "red", type: "image" })).toBe(
      "span"
    );
    expect(tagOf({ id: "i", src: "x.png", type: "image" })).toBe("img");
  });
});
