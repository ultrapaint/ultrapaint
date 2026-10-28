import { SPACING_STEPS } from "@ultrapaint/contracts/token-table";
import { describe, expect, it } from "vitest";
import { TOOLBAR_SPACING } from "./spacing.ts";

describe("the toolbar's spacing", () => {
  it("offers a few of the same steps the inspector offers", () => {
    expect(TOOLBAR_SPACING).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12]);
    expect(TOOLBAR_SPACING.every((step) => SPACING_STEPS.includes(step))).toBe(
      true
    );
  });
});
