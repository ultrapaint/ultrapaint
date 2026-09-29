import { describe, expect, it } from "vitest";
import {
  axesSplit,
  sharedSide,
  sidesLabel,
  sidesOf,
  spacingOf,
  withSides,
} from "./sides.ts";

const show = (v: number | string) => String(v);

describe("sidesOf and spacingOf", () => {
  it("opens one value to four sides and closes four equal sides to one", () => {
    expect(sidesOf(8)).toEqual({ bottom: 8, left: 8, right: 8, top: 8 });
    expect(spacingOf({ bottom: 8, left: 8, right: 8, top: 8 })).toBe(8);
    expect(spacingOf({ left: 8, top: 4 })).toEqual({ left: 8, top: 4 });
    expect(spacingOf({})).toBeNull();
  });
});

describe("withSides", () => {
  it("sets the sides given and keeps the others", () => {
    expect(withSides(8, ["left", "right"], 12)).toEqual({
      bottom: 8,
      left: 12,
      right: 12,
      top: 8,
    });
    expect(withSides({ left: 4 }, ["top", "right", "bottom"], 4)).toBe(4);
  });

  it("takes sides off with null, and the whole value with its last side", () => {
    expect(withSides(8, ["top", "bottom"], null)).toEqual({
      left: 8,
      right: 8,
    });
    expect(withSides({ top: 4 }, ["top"], null)).toBeNull();
  });
});

describe("sharedSide", () => {
  it("gives the value the sides share across nodes, or says they differ", () => {
    expect(sharedSide([{ left: 8, right: 8 }, 8], ["left", "right"])).toEqual({
      mixed: false,
      value: 8,
    });
    expect(sharedSide([{ left: 8, right: 4 }], ["left", "right"]).mixed).toBe(
      true
    );
    expect(sharedSide([undefined], ["top"])).toEqual({
      mixed: false,
      value: undefined,
    });
  });
});

describe("axesSplit", () => {
  it("is true only when the two sides of an axis differ", () => {
    expect(axesSplit({ bottom: 6, left: 12, right: 12, top: 6 })).toBe(false);
    expect(axesSplit({ left: 8, right: 12 })).toBe(true);
    expect(axesSplit(undefined)).toBe(false);
  });
});

describe("sidesLabel", () => {
  it("reads one value, horizontal then vertical, or the four sides", () => {
    expect(sidesLabel(16, show)).toBe("16");
    expect(sidesLabel(undefined, show)).toBe("0");
    expect(sidesLabel({ bottom: 6, left: 12, right: 12, top: 6 }, show)).toBe(
      "12, 6"
    );
    expect(sidesLabel({ bottom: 6, left: 8, right: 12, top: 6 }, show)).toBe(
      "6, 12, 6, 8"
    );
    expect(sidesLabel({ left: 4 }, show)).toBe("0, 0, 0, 4");
  });
});
