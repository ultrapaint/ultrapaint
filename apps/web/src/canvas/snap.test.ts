import { describe, expect, it } from "vitest";
import { GRID, snapBox, snapPoint, snapToEdges } from "./snap.ts";

const frame = { height: 100, preset: "custom" as const, width: 100 };

describe("a point on the grid", () => {
  it("goes to the nearest line, either way", () => {
    expect(snapPoint({ x: 11, y: 13 })).toEqual({ x: 8, y: 16 });
    expect(snapPoint({ x: -3, y: -5 })).toEqual({ x: 0, y: -8 });
    expect(GRID).toBe(8);
  });
});

describe("a resize on the grid", () => {
  const from = { height: 80, width: 160, x: 0, y: 0 };

  it("snaps the edges the corner moves, and keeps the opposite corner", () => {
    expect(
      snapBox({ height: 83, width: 165, x: 0, y: 0 }, from, "se", 8, false)
    ).toEqual({ height: 80, width: 168, x: 0, y: 0 });
    // Dragged from the top left: the right and bottom edges stay where they were.
    expect(
      snapBox({ height: 91, width: 171, x: -11, y: -11 }, from, "nw", 8, false)
    ).toEqual({ height: 88, width: 168, x: -8, y: -8 });
    // From the top right: the left edge stays off the grid, where it was.
    expect(
      snapBox({ height: 77, width: 150, x: 10, y: 3 }, from, "ne", 8, false)
    ).toEqual({ height: 80, width: 150, x: 10, y: 0 });
  });

  it("never goes under the minimum", () => {
    // The right edge would snap back onto the left one: it goes to the next line out.
    expect(
      snapBox({ height: 20, width: 3, x: 0, y: 0 }, from, "se", 8, false)
    ).toMatchObject({ width: 8 });
    // 123 is nearest 120, which would leave 117 from an edge at 3.
    expect(
      snapBox({ height: 120, width: 120, x: 3, y: 0 }, from, "se", 120, false)
    ).toMatchObject({ height: 120, width: 125 });
  });

  it("keeps the ratio, from the side nearer the grid", () => {
    // 2:1. The width is 1 off a line, the height 3.5: the width decides.
    expect(
      snapBox({ height: 84.5, width: 169, x: 0, y: 0 }, from, "se", 8, true)
    ).toEqual({ height: 84, width: 168, x: 0, y: 0 });
    // Dragged from the top left, the box grows up and left from its fixed corner.
    expect(
      snapBox({ height: 84.5, width: 169, x: -9, y: -4.5 }, from, "nw", 8, true)
    ).toEqual({ height: 84, width: 168, x: -8, y: -4 });
  });
});

describe("a frame against the edges of others", () => {
  it("lines up with an edge within the threshold, and not beyond", () => {
    const other = { ...frame, x: 0, y: 0 };
    expect(snapToEdges({ ...frame, x: 104, y: 3 }, [other], 8)).toMatchObject({
      x: 100,
      y: 0,
    });
    expect(snapToEdges({ ...frame, x: 120, y: 30 }, [other], 8)).toMatchObject({
      x: 120,
      y: 30,
    });
  });
});
