import { describe, expect, it } from "vitest";
import { boardLayout, ROW_GAP, UNMEASURED } from "./board-layout.ts";

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
