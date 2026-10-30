import { describe, expect, it } from "vitest";
import {
  BOARD_GAP,
  BOARD_MARGIN,
  boardLayout,
  boardRoom,
  firstBoardView,
  ROW_GAP,
  UNMEASURED,
  wrappedBoards,
} from "./board-layout.ts";

const sizes = {
  a: { height: 200, width: 400 },
  b: { height: 100, width: 300 },
};

describe("boardLayout", () => {
  it("puts the boards side by side in a row, from the origin", () => {
    expect(boardLayout(["a", "b"], sizes, "row")).toEqual({
      a: { height: 200, width: 400, x: 0, y: 0 },
      b: { height: 100, width: 300, x: 400 + ROW_GAP, y: 0 },
    });
  });

  it("puts them one under the other in a column", () => {
    expect(boardLayout(["a", "b"], sizes, "column", 10)).toEqual({
      a: { height: 200, width: 400, x: 0, y: 0 },
      b: { height: 100, width: 300, x: 0, y: 210 },
    });
  });

  it("draws a board not measured yet at a size of its own", () => {
    expect(boardLayout(["c", "a"], sizes, "row", 0)).toEqual({
      a: { height: 200, width: 400, x: UNMEASURED.width, y: 0 },
      c: { ...UNMEASURED, x: 0, y: 0 },
    });
  });
});

describe("wrappedBoards", () => {
  it("keeps boards that fit side by side", () => {
    expect(wrappedBoards(["a", "b"], sizes, 400 + ROW_GAP + 300)).toEqual({
      a: { height: 200, width: 400, x: 0, y: 0 },
      b: { height: 100, width: 300, x: 400 + ROW_GAP, y: 0 },
    });
  });

  it("puts the one that would not fit under the tallest of its row", () => {
    const wrapped = wrappedBoards(
      ["a", "b", "c"],
      { ...sizes, c: sizes.a },
      750
    );
    expect(wrapped.b).toEqual({
      height: 100,
      width: 300,
      x: 400 + ROW_GAP,
      y: 0,
    });
    expect(wrapped.c).toEqual({
      height: 200,
      width: 400,
      x: 0,
      y: 200 + BOARD_GAP,
    });
  });

  it("gives a board wider than the room a row of its own, none empty before it", () => {
    const wrapped = wrappedBoards(["a", "b"], sizes, 100);
    expect(wrapped.a).toEqual({ height: 200, width: 400, x: 0, y: 0 });
    expect(wrapped.b).toEqual({
      height: 100,
      width: 300,
      x: 0,
      y: 200 + BOARD_GAP,
    });
  });

  it("draws wide variants stacked at 100% where side by side they would shrink", () => {
    const seen = { width: 640, x: 400 };
    const wide = {
      a: { height: 100, width: 552 },
      b: { height: 100, width: 552 },
    };
    const boxes = wrappedBoards(["a", "b"], wide, boardRoom(seen));
    expect(firstBoardView(Object.values(boxes), seen).zoom).toBe(1);
  });
});

describe("firstBoardView", () => {
  const seen = { width: 1000, x: 400 };

  it("starts the boards a little in from the seen part's corner, at 100%", () => {
    expect(
      firstBoardView([{ height: 200, width: 400, x: 0, y: 0 }], seen)
    ).toEqual({ x: 400 + BOARD_MARGIN.x, y: BOARD_MARGIN.y, zoom: 1 });
  });

  it("zooms out until every board fits between the panels, never in", () => {
    const view = firstBoardView(
      [
        { height: 200, width: 600, x: 0, y: 0 },
        { height: 200, width: 600, x: 600 + ROW_GAP, y: 0 },
      ],
      seen
    );
    const wide = 1200 + ROW_GAP;
    expect(view.zoom).toBeCloseTo((1000 - 2 * BOARD_MARGIN.x) / wide);
    // The last board's right edge is the margin in from the seen part's.
    expect(view.x + wide * view.zoom).toBeCloseTo(
      seen.x + seen.width - BOARD_MARGIN.x
    );
  });
});
