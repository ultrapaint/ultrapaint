import { describe, expect, it } from "vitest";
import { familyOf, isColor, isDimension, resolveCss } from "./values.ts";

const lookupOf =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

describe("isColor", () => {
  it("takes what CSS takes as a colour", () => {
    for (const value of [
      "#fff",
      "#1A1C1Eff",
      "oklch(0.205 0 0)",
      "rgb(0 0 0 / 50%)",
      "color-mix(in srgb, red 50%, blue)",
      "cornflowerblue",
      "transparent",
    ]) {
      expect(isColor(value), value).toBe(true);
    }
  });

  it("refuses what is not one, or not resolved yet", () => {
    for (const value of ["var(--primary)", "currentColor", "#ggg", "1px"]) {
      expect(isColor(value), value).toBe(false);
    }
  });
});

describe("isDimension", () => {
  it("takes px, em and rem only", () => {
    expect(isDimension("0.25rem")).toBe(true);
    expect(isDimension("-0.02em")).toBe(true);
    expect(isDimension("12px")).toBe(true);
    expect(isDimension("50%")).toBe(false);
    expect(isDimension("12")).toBe(false);
  });
});

describe("resolveCss", () => {
  const lookup = lookupOf({
    primary: "oklch(0.205 0 0)",
    radius: "0.625rem",
    ring: "var(--primary)",
  });

  it("follows variables, through each other", () => {
    expect(resolveCss("var(--ring)", lookup)).toBe("oklch(0.205 0 0)");
    expect(resolveCss("var(--nope, #fff)", lookup)).toBe("#fff");
    expect(resolveCss("var(--nope)", lookup)).toBeNull();
  });

  it("works out the arithmetic of shadcn's radii and Tailwind's line heights", () => {
    expect(resolveCss("calc(var(--radius) - 4px)", lookup)).toBe("6px");
    expect(resolveCss("calc(var(--radius) + 4px)", lookup)).toBe("14px");
    expect(resolveCss("calc(2.5 / 2.25)", lookup)).toBe("1.1111");
    expect(resolveCss("calc(1rem * 1.5)", lookup)).toBe("1.5rem");
    expect(resolveCss("calc(infinity * 1px)", lookup)).toBe("9999px");
  });

  it("gives up on what it cannot work out", () => {
    expect(resolveCss("calc(1em + 2px)", lookup)).toBeNull();
    expect(resolveCss("calc(100% - 2px)", lookup)).toBeNull();
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
