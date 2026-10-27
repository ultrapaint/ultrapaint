import { describe, expect, it } from "vitest";
import {
  type Color,
  hexOf,
  inCodeUnits,
  isColor,
  parseColor,
  parseLength,
  parseNumber,
  parseValue,
  printColor,
  printLength,
  sameValue,
  toPx,
  toSrgb,
} from "./token-value.ts";

const hex = (css: string) => {
  const color = parseColor(css);
  return color && hexOf(color);
};

describe("parseColor", () => {
  it("reads hex, names and sRGB's functions with channels from 0 to 1", () => {
    expect(parseColor("#3B82F6")).toEqual({
      alpha: 1,
      channels: [59 / 255, 130 / 255, 246 / 255],
      kind: "color",
      space: "srgb",
    });
    expect(parseColor("#fff")?.alpha).toBe(1);
    expect(parseColor("#0008")?.alpha).toBeCloseTo(0x88 / 255);
    expect(parseColor("transparent")?.alpha).toBe(0);
    expect(hex("cornflowerblue")).toBe("#6495ed");
    expect(hex("rgb(59 130 246)")).toBe("#3b82f6");
    expect(hex("rgba(59, 130, 246, 0.5)")).toBe("#3b82f680");
    expect(hex("rgb(100% 0% 0% / 50%)")).toBe("#ff000080");
    expect(parseColor("color(srgb 1 0.5 0)")?.channels).toEqual([1, 0.5, 0]);
  });

  it("keeps each space's channels in its own ranges", () => {
    expect(parseColor("oklch(62.3% 0.214 259.815)")).toMatchObject({
      space: "oklch",
    });
    expect(parseColor("oklch(62.3% 0.214 259.815)")?.channels[0]).toBeCloseTo(
      0.623
    );
    expect(parseColor("hsl(210 40% 96.1%)")?.channels).toEqual([210, 40, 96.1]);
    expect(parseColor("hsla(0.5turn, 50%, 50%, 1)")?.channels).toEqual([
      180, 50, 50,
    ]);
    expect(parseColor("lch(50% 75% 40)")?.channels).toEqual([50, 112.5, 40]);
    expect(parseColor("oklch(0.7 0.1 none / 0.5)")).toMatchObject({
      alpha: 0.5,
      channels: [0.7, 0.1, "none"],
    });
    expect(parseColor("color(xyz 0.5 0.5 0.5)")?.space).toBe("xyz-d65");
  });

  it("works out sRGB from every space it reads", () => {
    // CSS red in each of them.
    for (const css of [
      "hwb(0 0% 0%)",
      "hsl(0 100% 50%)",
      "lab(54.29 80.82 69.91)",
      "lch(54.29 106.84 40.85)",
      "oklab(0.628 0.2249 0.1258)",
      "oklch(0.628 0.2577 29.23)",
      "color(srgb-linear 1 0 0)",
      "color(display-p3 0.9175 0.2003 0.1386)",
      "color(a98-rgb 0.859 0 0)",
      "color(prophoto-rgb 0.7022 0.2757 0.1036)",
      "color(rec2020 0.7919 0.2307 0.0739)",
      "color(xyz-d65 0.4124 0.2126 0.0193)",
      "color(xyz-d50 0.436 0.2225 0.0139)",
    ]) {
      expect(hex(css), css).toBe("#ff0000");
    }
    // Out of sRGB's gamut, clamped into it.
    const wide = parseColor("color(display-p3 0 1 0)") as Color;
    expect(toSrgb(wide)).toEqual([0, 1, 0, 1]);
  });

  it("reads nothing else", () => {
    for (const css of [
      "var(--x)",
      "currentColor",
      "#ggg",
      "#12345",
      "rgb(1 2)",
      "hsl(10% 50% 50%)",
      "color(foo 1 2 3)",
      "1px",
    ]) {
      expect(parseColor(css), css).toBeNull();
    }
  });
});

describe("isColor", () => {
  it("takes what CSS takes as a colour, mixes included", () => {
    for (const css of [
      "#fff",
      "#1A1C1Eff",
      "oklch(0.205 0 0)",
      "rgb(0 0 0 / 50%)",
      "color-mix(in srgb, red 50%, blue)",
      "cornflowerblue",
      "transparent",
    ]) {
      expect(isColor(css), css).toBe(true);
    }
  });

  it("refuses what is not one, or not resolved yet", () => {
    for (const css of ["var(--primary)", "currentColor", "#ggg", "1px"]) {
      expect(isColor(css), css).toBe(false);
    }
  });
});

describe("parseValue", () => {
  it("tells a length, a duration, a number and anything else apart", () => {
    expect(parseValue("0.75rem")).toEqual({
      kind: "length",
      unit: "rem",
      value: 0.75,
    });
    expect(parseValue("-0.02EM")).toEqual({
      kind: "length",
      unit: "em",
      value: -0.02,
    });
    expect(parseValue("50%")).toMatchObject({ kind: "length", unit: "%" });
    expect(parseValue("150ms")).toEqual({
      kind: "duration",
      unit: "ms",
      value: 150,
    });
    expect(parseValue("1.5")).toEqual({ kind: "number", value: 1.5 });
    expect(parseValue("0")).toEqual({ kind: "number", value: 0 });
    expect(parseValue("0 1px 2px #000")).toEqual({
      css: "0 1px 2px #000",
      kind: "other",
    });
    expect(parseValue("12parsecs").kind).toBe("other");
    expect(parseLength("12")).toBeNull();
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("1px")).toBeNull();
  });
});

describe("sameValue", () => {
  it("takes a colour however it is written, within a step of 255", () => {
    expect(sameValue("#3b82f6", "#3B82F6")).toBe(true);
    expect(sameValue("#3b82f6", "rgb(59 130 246)")).toBe(true);
    expect(sameValue("#3b82f6", "rgba(59, 130, 246, 1)")).toBe(true);
    // Tailwind's blue-500, as its theme writes it.
    expect(sameValue("#2b7fff", "oklch(62.3% 0.214 259.815)")).toBe(true);
    expect(sameValue("#ffffff", "hsl(0 0% 100%)")).toBe(true);
    expect(sameValue("white", "#fff")).toBe(true);
    expect(sameValue("#00000080", "rgb(0 0 0 / 0.5)")).toBe(true);
    expect(sameValue("#ff0000", "lab(54.29 80.82 69.91)")).toBe(true);
    expect(sameValue("rgb(10 10 10)", "rgb(11 10 10)")).toBe(true);
    expect(sameValue("rgb(10 10 10)", "rgb(12 10 10)")).toBe(false);
    expect(sameValue("#3b82f6", "#2563eb")).toBe(false);
  });

  it("takes a length in px or rem, a duration and a number by what they come to", () => {
    expect(sameValue("12px", "0.75rem")).toBe(true);
    expect(sameValue("12px", "1rem")).toBe(false);
    expect(sameValue("1em", "16px")).toBe(false);
    expect(sameValue("1.5em", "1.5em")).toBe(true);
    expect(sameValue("0", "0px")).toBe(true);
    expect(sameValue("1s", "1000ms")).toBe(true);
    expect(sameValue("600", "600.00")).toBe(true);
    expect(sameValue("1.5", "1.6")).toBe(false);
  });

  it("takes anything else written alike", () => {
    expect(
      sameValue(
        "0px 4px 8px 0px rgba(0, 0, 0, 0.1)",
        "0 4px 8px 0 RGBA(0, 0, 0, 0.1)"
      )
    ).toBe(true);
    expect(sameValue("Inter, sans-serif", "Inter,  sans-serif")).toBe(true);
    expect(sameValue("Inter, sans-serif", "Geist, sans-serif")).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
    expect(sameValue("1px", undefined)).toBe(false);
  });
});

describe("converting and printing", () => {
  it("gives a length in pixels, and a source's in the code's unit", () => {
    expect(toPx("1.5rem")).toBe(24);
    expect(toPx("13px")).toBe(13);
    expect(toPx("1em")).toBeNull();
    expect(inCodeUnits("12px", "0.5rem")).toBe("0.75rem");
    expect(inCodeUnits("10px", "1rem")).toBe("0.625rem");
    expect(inCodeUnits("12px", "8px")).toBe("12px");
    expect(inCodeUnits("#ff0000", "oklch(0.6 0.2 30)")).toBe("#ff0000");
  });

  it("writes a colour in its space's function and a length without float noise", () => {
    const print = (css: string) => printColor(parseColor(css) as Color);
    expect(print("#3b82f6")).toBe("rgb(59 130 246)");
    expect(print("hsl(210deg 40% 96.1% / 50%)")).toBe(
      "hsl(210 40% 96.1% / 0.5)"
    );
    expect(print("oklch(62.3% 0.214 259.815)")).toBe(
      "oklch(0.623 0.214 259.815)"
    );
    expect(print("oklch(0.7 0.1 none)")).toBe("oklch(0.7 0.1 none)");
    expect(print("color(display-p3 1 0.5 0)")).toBe(
      "color(display-p3 1 0.5 0)"
    );
    expect(printLength({ unit: "rem", value: 1 / 3 })).toBe("0.3333rem");
  });
});
