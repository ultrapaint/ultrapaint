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
  const at = (x: number, y: number) => ({ ...frame, x, y });

  it("lines up with an edge within the threshold, and not beyond", () => {
    const other = at(0, 0);
    expect(snapToEdges(at(104, 3), [other], 8).frame).toMatchObject({
      x: 100,
      y: 0,
    });
    expect(snapToEdges(at(120, 30), [other], 8)).toEqual({
      frame: at(120, 30),
      guides: [],
    });
  });

  it("says which edge it lined up with: the line across both frames, and the space between them", () => {
    // 140 under a frame at the origin, 3 to the right of its left edge.
    const above = at(0, 0);
    expect(snapToEdges(at(3, 140), [above], 8)).toEqual({
      frame: at(0, 140),
      guides: [
        {
          at: 0,
          axis: "x",
          from: 0,
          gap: { from: 100, length: 40, to: 140 },
          matched: above,
          to: 240,
        },
      ],
    });
  });

  it("gives a line for each axis it snaps on, each with its own space", () => {
    const above = at(0, 0);
    const left = at(-200, 300);
    const { frame: placed, guides } = snapToEdges(at(3, 297), [above, left], 8);
    expect(placed).toEqual(at(0, 300));
    expect(guides).toEqual([
      {
        at: 0,
        axis: "x",
        from: 0,
        gap: { from: 100, length: 200, to: 300 },
        matched: above,
        to: 400,
      },
      {
        at: 300,
        axis: "y",
        from: -200,
        gap: { from: -100, length: 100, to: 0 },
        matched: left,
        to: 100,
      },
    ]);
  });

  it("gives no space for frames that touch or overlap along the line", () => {
    // Side by side, their tops lined up: they touch along the top's line and overlap along the
    // shared side's.
    const { guides } = snapToEdges(at(104, 3), [at(0, 0)], 8);
    expect(guides).toMatchObject([
      { at: 100, axis: "x", from: 0, gap: null, to: 100 },
      { at: 0, axis: "y", from: 0, gap: null, to: 200 },
    ]);
  });

  it("lines up with the nearest edge in reach, whatever the order of the frames", () => {
    // Right edges at 100 and 106: the frame's left edge at 104 is 2 from the second.
    const near = at(6, 300);
    const far = at(0, 0);
    for (const others of [
      [near, far],
      [far, near],
    ]) {
      const { frame: placed, guides } = snapToEdges(at(104, 150), others, 8);
      expect(placed.x).toBe(106);
      expect(guides).toMatchObject([{ at: 106, axis: "x", matched: near }]);
    }
  });

  it("takes the frame nearer along the other axis when two edges are as near", () => {
    // Right edges at 100 and 108, the frame's left edge at 104 between: the one 50 above it wins
    // over the one 750 below.
    const close = at(0, 0);
    const distant = at(8, 1000);
    for (const others of [
      [close, distant],
      [distant, close],
    ]) {
      const { frame: placed, guides } = snapToEdges(at(104, 150), others, 8);
      expect(placed.x).toBe(100);
      expect(guides).toMatchObject([{ at: 100, matched: close }]);
    }
  });

  it("runs the line across every frame on the edge, the space to the nearest", () => {
    // A column of frames whose left or right edge is at 0, the frame moved 30 under the first.
    const first = at(0, 0);
    const second = at(0, 300);
    const beside = at(-100, 600);
    const elsewhere = at(500, 0);
    const { guides } = snapToEdges(
      at(3, 130),
      [second, beside, elsewhere, first],
      8
    );
    expect(guides).toEqual([
      {
        at: 0,
        axis: "x",
        from: 0,
        gap: { from: 100, length: 30, to: 130 },
        matched: first,
        to: 700,
      },
    ]);
  });
});
