import { describe, expect, it } from "vitest";
import { SPACING_SCALE, TOOLBAR_SPACING } from "./spacing.ts";

describe("the spacing scale", () => {
  it("has Tailwind's named steps, in order", () => {
    expect(SPACING_SCALE).toContain(3.5);
    expect(SPACING_SCALE).toContain(96);
    expect([...SPACING_SCALE].sort((a, b) => a - b)).toEqual(SPACING_SCALE);
  });

  it("offers the toolbar a few of the same steps the inspector offers", () => {
    expect(TOOLBAR_SPACING).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12]);
    expect(TOOLBAR_SPACING.every((step) => SPACING_SCALE.includes(step))).toBe(
      true
    );
  });
});
