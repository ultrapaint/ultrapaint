import { describe, expect, it } from "vitest";
import { inCodeUnits, parseColor, sameValue } from "./services/token-values.ts";

describe("token values", () => {
  it("are one colour however they are written", () => {
    expect(sameValue("#3b82f6", "#3B82F6")).toBe(true);
    expect(sameValue("#3b82f6", "rgb(59 130 246)")).toBe(true);
    expect(sameValue("#3b82f6", "rgba(59, 130, 246, 1)")).toBe(true);
    // Tailwind's blue-500, as its theme writes it.
    expect(sameValue("#2b7fff", "oklch(62.3% 0.214 259.815)")).toBe(true);
    expect(sameValue("#ffffff", "hsl(0 0% 100%)")).toBe(true);
    expect(sameValue("#3b82f6", "#2563eb")).toBe(false);
    expect(sameValue("#00000080", "rgb(0 0 0 / 0.5)")).toBe(true);
    expect(parseColor("var(--x)")).toBeNull();
  });

  it("are one length in px or rem, and one number", () => {
    expect(sameValue("12px", "0.75rem")).toBe(true);
    expect(sameValue("12px", "1rem")).toBe(false);
    expect(sameValue("600", "600")).toBe(true);
    expect(
      sameValue(
        "0px 4px 8px 0px rgba(0, 0, 0, 0.1)",
        "0 4px 8px 0 rgba(0, 0, 0, 0.1)"
      )
    ).toBe(true);
  });

  it("are written in the unit the code uses", () => {
    expect(inCodeUnits("12px", "0.5rem")).toBe("0.75rem");
    expect(inCodeUnits("12px", "8px")).toBe("12px");
    expect(inCodeUnits("#ff0000", "oklch(0.6 0.2 30)")).toBe("#ff0000");
  });
});
