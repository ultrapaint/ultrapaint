import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import { shadowsOf } from "@ultrapaint/design-document/shadow";
import type { FigNode, FigPaint } from "openfig-core";
import { describe, expect, it } from "vitest";
import { boxOf, frameSize, paddingOf, sizeOf, stackFields } from "./layout.ts";
import { makeTokenMatcher, noTokens } from "./paint.ts";
import { solid } from "./testing/fixture.ts";

const node = (fields: Partial<FigNode>): FigNode =>
  ({ guid: { localID: 1, sessionID: 1 }, type: "FRAME", ...fields }) as FigNode;

describe("a node's box", () => {
  it("reads padding as one number, or side by side", () => {
    expect(paddingOf(node({}))).toBeUndefined();
    expect(paddingOf(node({ stackPadding: 8 }))).toBe(8);
    expect(
      paddingOf(
        node({
          stackHorizontalPadding: 16,
          stackPaddingBottom: 4,
          stackVerticalPadding: 8,
        })
      )
    ).toEqual({ bottom: 4, left: 16, right: 16, top: 8 });
  });

  it("reads fill, dashed border, corners, shadow and opacity", () => {
    const box = boxOf(
      node({
        dashPattern: [4, 2],
        effects: [
          {
            color: { a: 1, b: 0, g: 0, r: 0 },
            offset: { x: 0, y: 2 },
            radius: 4,
            type: "DROP_SHADOW",
            visible: true,
          },
          { radius: 1, type: "LAYER_BLUR", visible: true },
        ],
        fillPaints: [solid(1, 0, 0)],
        name: "Card",
        opacity: 0.5,
        rectangleBottomLeftCornerRadius: 0,
        rectangleBottomRightCornerRadius: 0,
        rectangleCornerRadiiIndependent: true,
        rectangleTopLeftCornerRadius: 8,
        rectangleTopRightCornerRadius: 8,
        size: { x: 100, y: 40 },
        strokePaints: [solid(0, 0, 1)],
        strokeWeight: 1.5,
      } as Partial<FigNode>),
      { direction: null },
      { height: 40, width: 100 },
      noTokens
    );
    expect(box).toEqual({
      border: { color: "#0000ff", style: "dashed", width: 1.5 },
      fill: "#ff0000",
      height: 40,
      name: "Card",
      opacity: 0.5,
      radius: "8px 8px 0px 0px",
      shadow: "0px 2px 4px 0px rgba(0, 0, 0, 1)",
      width: 100,
    });
  });

  it("writes a frame's drop and inner shadows as one list the shadow split reads as two", () => {
    const box = boxOf(
      node({
        effects: [
          {
            color: { a: 0.25, b: 0, g: 0, r: 0 },
            offset: { x: 0, y: 4 },
            radius: 8,
            type: "DROP_SHADOW",
            visible: true,
          },
          {
            color: { a: 1, b: 1, g: 1, r: 1 },
            offset: { x: 0, y: 1 },
            radius: 0,
            type: "INNER_SHADOW",
            visible: true,
          },
        ],
        size: { x: 100, y: 40 },
      } as Partial<FigNode>),
      { direction: null },
      { height: 40, width: 100 },
      noTokens
    );
    expect(shadowsOf(box.shadow)).toEqual([
      "0px 4px 8px 0px rgba(0, 0, 0, 0.25)",
      "inset 0px 1px 0px 0px rgba(255, 255, 255, 1)",
    ]);
  });

  /** A box of 200 by 100 filled with one gradient paint. */
  const gradientBox = (paint: Partial<FigPaint>, tokens = noTokens) =>
    boxOf(
      node({
        fillPaints: [
          {
            opacity: 1,
            stops: [
              { color: { a: 1, b: 1, g: 1, r: 1 }, position: 0 },
              { color: { a: 1, b: 0, g: 0, r: 0 }, position: 1 },
            ],
            type: "GRADIENT_LINEAR",
            visible: true,
            ...paint,
          },
        ],
        size: { x: 200, y: 100 },
      } as Partial<FigNode>),
      { direction: null },
      { height: undefined, width: undefined },
      tokens
    ).fill;
  const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

  it("is a linear gradient at its own angle, its stops where its handles put them", () => {
    // Figma's default: from the top edge to the bottom one.
    expect(
      gradientBox({
        transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
      })
    ).toBe("linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(0, 0, 0, 1))");
    // Left to right, its handles across the left half only.
    expect(
      gradientBox({
        transform: { ...IDENTITY, m00: 2 },
      })
    ).toBe(
      "linear-gradient(90deg, rgba(255, 255, 255, 1), rgba(0, 0, 0, 1) 50%)"
    );
  });

  it("is a radial gradient as an ellipse at its centre, and an angular one as a conic gradient from its start", () => {
    expect(gradientBox({ transform: IDENTITY, type: "GRADIENT_RADIAL" })).toBe(
      "radial-gradient(50% 50% at 50% 50%, rgba(255, 255, 255, 1), rgba(0, 0, 0, 1))"
    );
    // Its start handle pointing down from the centre.
    expect(
      gradientBox({
        transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
        type: "GRADIENT_ANGULAR",
      })
    ).toBe(
      "conic-gradient(from 180deg at 50% 50%, rgba(255, 255, 255, 1), rgba(0, 0, 0, 1))"
    );
  });

  it("runs a skewed linear gradient across the lines its colours stay the same along", () => {
    // Its handles at (50, 25) and (150, 75); its colour lines at a slant of their own.
    expect(
      gradientBox({
        transform: { m00: 1, m01: 1, m02: -0.5, m10: -1, m11: 1, m12: 0.5 },
      })
    ).toBe(
      "linear-gradient(153.43deg, rgba(255, 255, 255, 1) 25%, rgba(0, 0, 0, 1) 75%)"
    );
  });

  it("is a radial gradient turned a quarter as the ellipse its axes swap to", () => {
    // Still half the box each way.
    expect(
      gradientBox({
        transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
        type: "GRADIENT_RADIAL",
      })
    ).toBe(
      "radial-gradient(50% 50% at 50% 50%, rgba(255, 255, 255, 1), rgba(0, 0, 0, 1))"
    );
  });

  it("writes a gradient's stops as the colour tokens that hold them", () => {
    const tokens = makeTokenMatcher({
      ...emptyDesignSystem(),
      colors: [
        {
          name: "Semantic",
          tokens: [{ name: "color-background", value: "oklch(1 0 0)" }],
        },
      ],
    });
    expect(gradientBox({ transform: IDENTITY }, tokens)).toBe(
      "linear-gradient(90deg, $color-background, rgba(0, 0, 0, 1))"
    );
  });
});

describe("a node's size", () => {
  it("fills where its parent grows or stretches it, on the axis the parent's direction says", () => {
    const own = { height: 40, width: 100 } as const;
    const growing = node({ stackChildPrimaryGrow: 1 });
    expect(sizeOf(growing, { direction: "row" }, own)).toEqual({
      height: 40,
      width: "fill",
    });
    expect(sizeOf(growing, { direction: "column" }, own)).toEqual({
      height: "fill",
      width: 100,
    });
    expect(sizeOf(growing, { direction: null }, own)).toEqual(own);
    const stretched = node({ stackChildAlignSelf: "STRETCH" });
    expect(sizeOf(stretched, { direction: "row" }, own)).toEqual({
      height: "fill",
      width: 100,
    });
  });

  it("hugs its content on the axes an auto layout frame says", () => {
    const size = { x: 120.456, y: 48 };
    expect(frameSize(node({ size }))).toEqual({ height: 48, width: 120.46 });
    expect(
      frameSize(
        node({
          size,
          stackCounterSizing: "FIXED",
          stackMode: "HORIZONTAL",
          stackPrimarySizing: "RESIZE_TO_FIT",
        })
      )
    ).toEqual({ height: 48, width: "hug" });
    expect(
      frameSize(
        node({
          size,
          stackCounterSizing: "RESIZE_TO_FIT",
          stackMode: "VERTICAL",
        })
      )
    ).toEqual({ height: 48, width: "hug" });
  });

  it("takes a stack's gap, alignment and wrap, and no gap when space is shared out", () => {
    expect(
      stackFields(
        node({
          stackCounterAlignItems: "CENTER",
          stackPrimaryAlignItems: "MAX",
          stackSpacing: 12,
          stackWrap: "WRAP",
        } as Partial<FigNode>)
      )
    ).toEqual({ align: "end", crossAlign: "center", gap: 12, wrap: true });
    expect(
      stackFields(
        node({ stackPrimaryAlignItems: "SPACE_BETWEEN", stackSpacing: 12 })
      )
    ).toEqual({
      align: "between",
      crossAlign: undefined,
      gap: undefined,
      wrap: undefined,
    });
  });
});
