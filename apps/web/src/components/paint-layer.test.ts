import { describe, expect, it } from "vitest";
import { leftAfter, strokeWidth } from "./paint-layer.tsx";

describe("the brush over the splash", () => {
  it("lays its full width when dragged slowly", () => {
    expect(strokeWidth(0)).toBe(14);
    expect(strokeWidth(5)).toBe(13);
  });

  it("lays a fast stroke thinner, but never thinner than a third of a slow one", () => {
    expect(strokeWidth(30)).toBe(8);
    expect(strokeWidth(200)).toBe(6);
  });

  it("leaves paint carried to the editor's page as it has dried since, and none after 2 s", () => {
    expect(leftAfter(0)).toBe(1);
    expect(leftAfter(500)).toBeCloseTo(0.344, 2);
    expect(leftAfter(2000)).toBe(0);
  });
});
