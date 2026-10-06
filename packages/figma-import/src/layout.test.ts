import type { FigNode } from "openfig-core";
import { describe, expect, it } from "vitest";
import { boxOf, frameSize, paddingOf, sizeOf, stackFields } from "./layout.ts";
import { noTokens } from "./paint.ts";
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

  it("is a gradient's stops when the fill is one", () => {
    const box = boxOf(
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
          },
        ],
      } as Partial<FigNode>),
      { direction: null },
      { height: undefined, width: undefined },
      noTokens
    );
    expect(box.fill).toBe(
      "linear-gradient(180deg, rgba(255, 255, 255, 1) 0%, rgba(0, 0, 0, 1) 100%)"
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
