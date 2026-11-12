import { describe, expect, it } from "vitest";
import { sizeLabel } from "./size-label.ts";

describe("the size under the selection", () => {
  it("names an axis that fills or hugs as the inspector does, and leaves fixed pixels bare", () => {
    expect(
      sizeLabel({ height: 15.4, width: 52.2 }, { height: "hug", width: "hug" })
    ).toBe("52 Hug × 15 Hug");
    expect(sizeLabel({ height: 40, width: 320 }, { width: "fill" })).toBe(
      "320 Fill × 40"
    );
  });

  it("is a page's frame's size, bare", () => {
    expect(sizeLabel({ height: 900, width: 1440 })).toBe("1440 × 900");
  });
});
