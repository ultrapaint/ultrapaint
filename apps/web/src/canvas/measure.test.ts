import { describe, expect, it } from "vitest";
import { measureLines } from "./measure.ts";

const box = (x: number, y: number, width: number, height: number) => ({
  height,
  width,
  x,
  y,
});

/** What a designer reads off the lines: each one's axis and length. */
const readings = (lines: ReturnType<typeof measureLines>) =>
  lines.map((l) => `${l.axis} ${l.length}`);

describe("two boxes apart on one axis", () => {
  it("gives the space between their facing edges, along the middle of what they share", () => {
    // A heading over a button 24 pixels under it.
    const lines = measureLines(box(0, 0, 200, 40), box(50, 64, 100, 30));
    expect(lines).toEqual([
      {
        axis: "y",
        from: { x: 100, y: 40 },
        guide: null,
        length: 24,
        to: { x: 100, y: 64 },
      },
    ]);
  });

  it("measures the same either way round, from the selection's edge", () => {
    const lines = measureLines(box(120, 0, 40, 40), box(0, 10, 100, 20));
    expect(lines).toEqual([
      {
        axis: "x",
        from: { x: 120, y: 20 },
        guide: null,
        length: 20,
        to: { x: 100, y: 20 },
      },
    ]);
  });

  it("gives nothing for edges that touch", () => {
    expect(measureLines(box(0, 0, 50, 50), box(50, 0, 50, 50))).toEqual([]);
  });
});

describe("two boxes apart on both axes", () => {
  it("gives the space on each axis, from the selection's middle, with a guide to the other box", () => {
    const lines = measureLines(box(0, 0, 40, 40), box(100, 80, 20, 20));
    expect(lines).toEqual([
      {
        axis: "x",
        from: { x: 40, y: 20 },
        guide: { from: { x: 100, y: 20 }, to: { x: 100, y: 80 } },
        length: 60,
        to: { x: 100, y: 20 },
      },
      {
        axis: "y",
        from: { x: 20, y: 40 },
        guide: { from: { x: 20, y: 80 }, to: { x: 100, y: 80 } },
        length: 40,
        to: { x: 20, y: 80 },
      },
    ]);
  });
});

describe("one box inside the other", () => {
  it("gives the four insets, across the inner box's middle", () => {
    const lines = measureLines(box(16, 24, 100, 50), box(0, 0, 200, 100));
    expect(readings(lines)).toEqual(["x 16", "x 84", "y 24", "y 26"]);
    // The left inset runs from the outer edge to the inner one, at the inner box's middle.
    expect(lines[0]).toMatchObject({
      from: { x: 16, y: 49 },
      to: { x: 0, y: 49 },
    });
  });

  it("is measured the same from the outer box", () => {
    const lines = measureLines(box(0, 0, 200, 100), box(16, 24, 100, 50));
    expect(readings(lines)).toEqual(["x 16", "x 84", "y 24", "y 26"]);
  });

  it("leaves out an edge the boxes share", () => {
    const lines = measureLines(box(0, 0, 100, 50), box(0, 0, 200, 100));
    expect(readings(lines)).toEqual(["x 100", "y 50"]);
  });
});

describe("two overlapping boxes", () => {
  it("gives the distances between their matching edges, across what they share", () => {
    const lines = measureLines(box(0, 0, 100, 100), box(60, 30, 100, 100));
    expect(readings(lines)).toEqual(["x 60", "x 60", "y 30", "y 30"]);
    // Drawn across the middle of the overlap: x from 60 to 100, y from 30 to 100.
    expect(lines[0]).toMatchObject({
      from: { x: 0, y: 65 },
      to: { x: 60, y: 65 },
    });
    expect(lines[2]).toMatchObject({
      from: { x: 80, y: 0 },
      to: { x: 80, y: 30 },
    });
  });
});

describe("a distance", () => {
  it("is rounded to the pixel", () => {
    const lines = measureLines(box(0, 0, 40.4, 40), box(64.2, 0, 10, 40));
    expect(readings(lines)).toEqual(["x 24"]);
  });

  it("is not drawn under half a pixel", () => {
    expect(measureLines(box(0, 0, 40, 40), box(40.3, 0, 10, 40))).toEqual([]);
  });

  it("is nothing between a box and itself", () => {
    expect(measureLines(box(8, 8, 40, 40), box(8, 8, 40, 40))).toEqual([]);
  });
});
