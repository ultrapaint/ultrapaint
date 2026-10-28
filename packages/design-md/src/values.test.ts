import { describe, expect, it } from "vitest";
import { familyOf, isDimension } from "./values.ts";

describe("isDimension", () => {
  it("takes px, em and rem only", () => {
    expect(isDimension("0.25rem")).toBe(true);
    expect(isDimension("-0.02em")).toBe(true);
    expect(isDimension("12px")).toBe(true);
    expect(isDimension("50%")).toBe(false);
    expect(isDimension("12")).toBe(false);
  });
});

describe("familyOf", () => {
  it("takes the first named family of a stack", () => {
    expect(familyOf("'Inter Variable', ui-sans-serif, sans-serif")).toBe(
      "Inter Variable"
    );
    expect(familyOf("ui-sans-serif, system-ui, Roboto, sans-serif")).toBe(
      "Roboto"
    );
    expect(familyOf("ui-monospace, monospace")).toBe("ui-monospace");
  });
});
