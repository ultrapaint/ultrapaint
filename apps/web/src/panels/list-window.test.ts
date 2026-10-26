import { describe, expect, it } from "vitest";
import { offsetsOf, windowOf } from "./list-window.ts";

describe("the window of a long list", () => {
  const tops = offsetsOf([28, 24, 24, 24, 32, 24]);

  it("knows where each line starts and how high the list is", () => {
    expect(tops).toEqual([0, 28, 52, 76, 100, 132, 156]);
  });

  it("draws the lines on screen and those within the overscan", () => {
    // 50px seen from the top: lines 0 and 1; line 2 starts at 52.
    expect(windowOf(tops, 0, 50, 0)).toEqual({ end: 2, start: 0 });
    // Scrolled to 60, 30px seen, 20px either side: from 40 to 110.
    expect(windowOf(tops, 60, 30, 20)).toEqual({ end: 5, start: 1 });
  });

  it("draws to the end and nothing past it", () => {
    // From 40, inside line 1, to the end.
    expect(windowOf(tops, 140, 400, 100)).toEqual({ end: 6, start: 1 });
    expect(windowOf(offsetsOf([]), 0, 400, 100)).toEqual({ end: 0, start: 0 });
  });
});
