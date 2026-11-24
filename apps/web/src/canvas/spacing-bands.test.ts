import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { addTokens } from "@ultrapaint/contracts/token-table";
import { describe, expect, it } from "vitest";
import {
  type Band,
  snapSpacing,
  spacingBands,
  spacingLabel,
  spacingNameOf,
  spacingPx,
  spacingTargets,
  stackOf,
} from "./spacing-bands.ts";

const NONE = { bottom: 0, left: 0, right: 0, top: 0 };

/** Three children of 40 by 20 in a row, 10 apart, inside 16 of padding. */
const row = {
  align: undefined,
  box: { height: 52, width: 172, x: 100, y: 200 },
  children: [
    { height: 20, width: 40, x: 116, y: 216 },
    { height: 20, width: 40, x: 166, y: 216 },
    { height: 20, width: 40, x: 216, y: 216 },
  ],
  direction: "row" as const,
  gap: 10,
  padding: { bottom: 16, left: 16, right: 16, top: 16 },
};

const gaps = (bands: readonly Band[]) => bands.filter((b) => b.field === "gap");
const sides = (bands: readonly Band[]) =>
  bands.flatMap((b) => (b.field === "padding" ? [b.side] : []));

describe("a stack's spacing bands", () => {
  it("has a gap band between each two children of a row, as tall as their line, dragged along it", () => {
    expect(gaps(spacingBands(row, 0))).toEqual([
      {
        axis: "x",
        field: "gap",
        hit: { height: 20, width: 10, x: 156, y: 216 },
        key: "gap-0",
        px: 10,
        rect: { height: 20, width: 10, x: 156, y: 216 },
        sign: 1,
      },
      expect.objectContaining({
        key: "gap-1",
        rect: { height: 20, width: 10, x: 206, y: 216 },
      }),
    ]);
  });

  it("has them across a column, dragged down it", () => {
    const column = {
      ...row,
      children: [
        { height: 20, width: 60, x: 116, y: 216 },
        { height: 30, width: 40, x: 116, y: 244 },
      ],
      direction: "column" as const,
      gap: 8,
    };
    expect(gaps(spacingBands(column, 0))).toEqual([
      expect.objectContaining({
        axis: "y",
        rect: { height: 8, width: 60, x: 116, y: 236 },
        sign: 1,
      }),
    ]);
  });

  it("draws a gap at its own width in the space a child's margin widens", () => {
    const [first, second] = row.children;
    const apart = {
      ...row,
      children: [first, { ...second, x: 176 }] as typeof row.children,
    };
    expect(gaps(spacingBands(apart, 0))[0]?.rect).toEqual({
      height: 20,
      width: 10,
      x: 161,
      y: 216,
    });
  });

  it("has a band for each padding side, each dragged into the box to grow it", () => {
    const apart = {
      ...row,
      padding: { bottom: 4, left: 8, right: 0, top: 12 },
    };
    const bands = spacingBands(apart, 0).filter((b) => b.field === "padding");
    expect(
      bands.map(({ axis, px, rect, side, sign }) => ({
        axis,
        px,
        rect,
        side,
        sign,
      }))
    ).toEqual([
      {
        axis: "y",
        px: 12,
        rect: { height: 12, width: 172, x: 100, y: 200 },
        side: "top",
        sign: 1,
      },
      {
        axis: "x",
        px: 0,
        rect: { height: 36, width: 0, x: 272, y: 212 },
        side: "right",
        sign: -1,
      },
      {
        axis: "y",
        px: 4,
        rect: { height: 4, width: 172, x: 100, y: 248 },
        side: "bottom",
        sign: -1,
      },
      {
        axis: "x",
        px: 8,
        rect: { height: 36, width: 8, x: 100, y: 212 },
        side: "left",
        sign: 1,
      },
    ]);
  });

  it("has no gap band with one child drawn, its padding bands kept", () => {
    const one = { ...row, children: row.children.slice(0, 1) };
    const bands = spacingBands(one, 0);
    expect(gaps(bands)).toEqual([]);
    expect(sides(bands)).toEqual(["top", "right", "bottom", "left"]);
  });

  it("has a gap band in each line of a wrapping row, none from a line's end to the next's start", () => {
    const wrapped = {
      ...row,
      children: [
        { height: 20, width: 40, x: 116, y: 216 },
        { height: 20, width: 40, x: 166, y: 216 },
        { height: 24, width: 40, x: 116, y: 246 },
        { height: 20, width: 40, x: 166, y: 246 },
      ],
    };
    expect(gaps(spacingBands(wrapped, 0)).map((b) => b.rect)).toEqual([
      { height: 20, width: 10, x: 156, y: 216 },
      { height: 24, width: 10, x: 156, y: 246 },
    ]);
  });

  it.each(["between", "around"] as const)(
    "has no gap band when the alignment spreads the children (%s), its padding bands kept",
    (align) => {
      const bands = spacingBands({ ...row, align }, 0);
      expect(gaps(bands)).toEqual([]);
      expect(sides(bands)).toEqual(["top", "right", "bottom", "left"]);
    }
  );

  it("can be grabbed at 0, the pointer's band never thinner than the least, inside the box", () => {
    const shut = { ...row, gap: 0, padding: NONE };
    const flush = {
      ...shut,
      children: [
        { height: 20, width: 40, x: 100, y: 200 },
        { height: 20, width: 40, x: 140, y: 200 },
      ],
    };
    const bands = spacingBands(flush, 6);
    expect(gaps(bands)[0]?.hit).toEqual({
      height: 20,
      width: 6,
      x: 137,
      y: 200,
    });
    const top = bands.find((b) => b.key === "padding-top");
    expect(top?.hit).toEqual({ height: 6, width: 172, x: 100, y: 200 });
    const bottom = bands.find((b) => b.key === "padding-bottom");
    expect(bottom?.hit).toEqual({ height: 6, width: 172, x: 100, y: 246 });
    // Between the two, so a corner is the top's or the bottom's.
    const left = bands.find((b) => b.key === "padding-left");
    expect(left?.hit).toEqual({ height: 40, width: 6, x: 100, y: 206 });
  });
});

describe("a short stack's side bands", () => {
  it("run the box's height when its top and bottom leave no room between them", () => {
    const empty = {
      ...row,
      box: { height: 32, width: 100, x: 0, y: 0 },
      children: [],
      padding: { bottom: 16, left: 8, right: 8, top: 16 },
    };
    const left = spacingBands(empty, 6).find((b) => b.key === "padding-left");
    expect(left?.hit).toEqual({ height: 32, width: 8, x: 0, y: 0 });
    // Shorter than two of the least, with no padding: never a negative height.
    const flat = {
      ...empty,
      box: { height: 10, width: 100, x: 0, y: 0 },
      padding: NONE,
    };
    for (const band of spacingBands(flat, 6)) {
      expect(band.hit.height).toBeGreaterThan(0);
      expect(band.rect.height).toBeGreaterThanOrEqual(0);
    }
  });

  it("leave no padding band under another, so each side is reached on a stack shorter than the least", () => {
    const flat = {
      ...row,
      box: { height: 5, width: 100, x: 0, y: 0 },
      children: [],
      padding: NONE,
    };
    const hits = spacingBands(flat, 6).map((b) => b.hit);
    const overlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height;
    for (const [i, a] of hits.entries()) {
      for (const b of hits.slice(i + 1)) {
        expect(overlap(a, b)).toBe(false);
      }
    }
  });
});

describe("a tiny stack's padding bands", () => {
  it.each([
    [6, 5],
    [5, 5],
    [8, 40],
    [40, 8],
    [1, 1],
  ])("each have an area of their own on a %ix%i stack", (width, height) => {
    const tiny = {
      ...row,
      box: { height, width, x: 0, y: 0 },
      children: [],
      padding: NONE,
    };
    const hits = spacingBands(tiny, 6).map((b) => b.hit);
    expect(hits).toHaveLength(4);
    for (const hit of hits) {
      expect(hit.width).toBeGreaterThan(0);
      expect(hit.height).toBeGreaterThan(0);
    }
    for (const [i, a] of hits.entries()) {
      for (const b of hits.slice(i + 1)) {
        expect(
          a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
        ).toBe(false);
      }
    }
  });
});

describe("the stack a node is", () => {
  it("is a row, a column or a page, and nothing else", () => {
    const kids = { children: [] };
    expect(
      stackOf({ ...kids, gap: 8, id: "r", type: "row" } as DesignNode)
    ).toMatchObject({ direction: "row", gap: 8 });
    expect(
      stackOf({ ...kids, id: "c", type: "column" } as DesignNode)
    ).toMatchObject({ direction: "column" });
    expect(
      stackOf({
        ...kids,
        align: "between",
        id: "p",
        type: "page",
      } as DesignNode)
    ).toMatchObject({ align: "between", direction: "column" });
    expect(
      stackOf({
        ...kids,
        direction: "row",
        id: "p",
        type: "page",
      } as DesignNode)
    ).toMatchObject({ direction: "row" });
    expect(stackOf({ ...kids, id: "g", type: "group" } as DesignNode)).toBe(
      null
    );
    expect(
      stackOf({
        id: "t",
        role: "paragraph",
        text: "Hi",
        type: "text",
      } as DesignNode)
    ).toBe(null);
  });
});

/** Spacing on a 4px base, with a gutter of 1.5rem and a token named as a step. */
const ds = addTokens(emptyDesignSystem(), [
  { name: "spacing-gutter", value: "1.5rem" },
  { name: "spacing-4", value: "1rem" },
  { name: "spacing-wide", value: "auto" },
]);
const targets = spacingTargets(ds);

describe("a dragged spacing", () => {
  it("snaps to the nearest of the scale's named steps, written as its pixels", () => {
    expect(snapSpacing(17.4, targets, false)).toEqual({
      name: "spacing-4",
      px: 16,
      value: 16,
    });
    expect(snapSpacing(-30, targets, false)).toEqual({
      name: "spacing-0",
      px: 0,
      value: 0,
    });
  });

  it("snaps to a named spacing, written as its token, which wins over a step of its size", () => {
    expect(snapSpacing(23, targets, false)).toEqual({
      name: "spacing-gutter",
      px: 24,
      value: "$spacing-gutter",
    });
  });

  it("follows the pointer to the pixel with ⌘/Ctrl, and is named by nothing", () => {
    expect(snapSpacing(17.4, targets, true)).toEqual({
      name: null,
      px: 17,
      value: 17,
    });
    expect(snapSpacing(-3, targets, true)).toEqual({
      name: null,
      px: 0,
      value: 0,
    });
  });

  it("takes the scale's base from the design system", () => {
    const eight = { ...emptyDesignSystem(), spacing: { base: "0.5rem" } };
    expect(snapSpacing(31, spacingTargets(eight), false)).toEqual({
      name: "spacing-4",
      px: 32,
      value: 32,
    });
  });
});

describe("a spacing's value", () => {
  it("is read in pixels from a number, a token, a step's name or a length", () => {
    expect(spacingPx(12, ds)).toBe(12);
    expect(spacingPx("$spacing-gutter", ds)).toBe(24);
    expect(spacingPx("$spacing-2.5", ds)).toBe(10);
    expect(spacingPx("0.5rem", ds)).toBe(8);
    expect(spacingPx(undefined, ds)).toBe(0);
    expect(spacingPx("$spacing-wide", ds)).toBe(0);
  });

  it("is named by the step or the named spacing it is", () => {
    expect(spacingNameOf(16, targets)).toBe("spacing-4");
    expect(spacingNameOf("$spacing-gutter", targets)).toBe("spacing-gutter");
    expect(spacingNameOf("$spacing-4", targets)).toBe("spacing-4");
    expect(spacingNameOf(17, targets)).toBe(null);
    expect(spacingNameOf(undefined, targets)).toBe(null);
  });

  it("is said in the pill as its field, its pixels and its name", () => {
    expect(spacingLabel("gap", 16, "spacing-4")).toBe("Gap 16 · spacing-4");
    expect(spacingLabel("padding", 24, "spacing-6")).toBe(
      "Padding 24 · spacing-6"
    );
    expect(spacingLabel("gap", 17, null)).toBe("Gap 17");
    expect(spacingLabel("padding", 2.346, null)).toBe("Padding 2.35");
  });
});
