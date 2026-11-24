import { describe, expect, it } from "vitest";
import { type DesignSystem, emptyDesignSystem } from "./design-system.ts";
import { nearestToken } from "./nearest-token.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  borderWidths: [{ name: "border-width-thin", value: "1px" }],
  colors: [
    {
      name: "Semantic",
      tokens: [
        {
          name: "color-ink",
          value: "oklab(0.5 0.1 0)",
          values: { dark: "oklab(0.9 0 0)" },
        },
        { name: "color-text", value: "$color-ink" },
        { name: "color-paper", value: "oklab(0.98 0 0)" },
      ],
    },
  ],
  radius: [
    { name: "radius-sm", value: "0.25rem" },
    { name: "radius-lg", value: "0.5rem" },
  ],
  shadows: [{ name: "shadow-sm", value: "0 1px 2px black" }],
  spacing: {
    base: "0.25rem",
    tokens: [{ name: "spacing-gutter", value: "1.3rem" }],
  },
  themes: ["light", "dark"],
  typography: {
    fonts: [{ name: "font-sans", value: "Inter, sans-serif" }],
    leading: [
      { name: "leading-tight", value: "1.25" },
      { name: "leading-loose", value: "2" },
    ],
    sizes: [
      { name: "text-sm", value: "0.875rem" },
      { name: "text-base", value: "1rem" },
    ],
    styles: [],
    weights: [
      { name: "font-weight-normal", value: "400" },
      { name: "font-weight-bold", value: "700" },
    ],
  },
};

const nearestName = (
  ...args: Parameters<typeof nearestToken>
): string | undefined => nearestToken(...args)?.name;

describe("the nearest token to a value", () => {
  it("is the colour nearest in OKLab, within 0.1, and none past it", () => {
    expect(nearestToken("color", "oklab(0.5 0.1 0.09)", ds)).toMatchObject({
      name: "color-ink",
      value: "oklab(0.5 0.1 0)",
    });
    expect(
      nearestToken("color", "oklab(0.5 0.1 0.09)", ds)?.distance
    ).toBeCloseTo(0.09, 4);
    expect(nearestName("color", "oklab(0.97 0 0.02)", ds)).toBe("color-paper");
    expect(nearestToken("color", "oklab(0.5 0.1 0.11)", ds)).toBeNull();
  });

  it("reads a colour token in the theme asked for, through a token it names, and gives the colour it comes to", () => {
    expect(
      nearestToken("color", "oklab(0.9 0 0.01)", ds, { theme: "dark" })
    ).toMatchObject({ name: "color-ink", value: "oklab(0.9 0 0)" });
    expect(nearestToken("color", "oklab(0.9 0 0.01)", ds)).toMatchObject({
      name: "color-paper",
    });
    // The alias is listed first, so of the two as near it is the one found.
    const aliased: DesignSystem = {
      ...ds,
      colors: [
        {
          name: "Semantic",
          tokens: [
            { name: "color-text", value: "var(--color-base)" },
            { name: "color-base", value: "oklab(0.5 0.1 0)" },
          ],
        },
      ],
    };
    const found = nearestToken("color", "oklab(0.5 0.1 0.05)", aliased);
    expect(found).toMatchObject({
      name: "color-text",
      value: "oklab(0.5 0.1 0)",
    });
    expect(found?.distance).toBeCloseTo(0.05, 4);
  });

  it("is the nearest whole or half step of the spacing scale, in pixels", () => {
    expect(nearestToken("spacing", 17.5, ds)).toEqual({
      distance: 0.5,
      name: "spacing-4.5",
      step: 4.5,
      value: "18px",
    });
    expect(nearestName("spacing", 3, { ...ds, spacing: { base: "6px" } })).toBe(
      "spacing-0.5"
    );
  });

  it("is a named spacing when it is nearer than any step", () => {
    expect(nearestToken("spacing", 21, ds)).toMatchObject({
      name: "spacing-gutter",
      value: "1.3rem",
    });
    expect(nearestToken("spacing", 21, ds)).not.toHaveProperty("step");
  });

  it("is the smaller of two as near", () => {
    expect(nearestToken("spacing", "17px", ds)).toMatchObject({
      name: "spacing-4",
      step: 4,
    });
    expect(nearestName("radius", 6, ds)).toBe("radius-sm");
    expect(nearestName("fontWeight", 550, ds)).toBe("font-weight-normal");
  });

  it("is the radius, font size and border width nearest in pixels, with no limit", () => {
    expect(nearestName("radius", "7px", ds)).toBe("radius-lg");
    expect(nearestToken("radius", 40, ds)).toMatchObject({
      distance: 32,
      name: "radius-lg",
    });
    expect(nearestName("fontSize", "15.5px", ds)).toBe("text-base");
    expect(nearestName("fontSize", 13, ds)).toBe("text-sm");
    expect(nearestName("borderWidth", 3, ds)).toBe("border-width-thin");
  });

  it("counts a unitless zero as no pixels, and an absolute length in pixels", () => {
    const radii: DesignSystem = {
      ...ds,
      radius: [
        { name: "radius-none", value: "0" },
        { name: "radius-large", value: "8px" },
        { name: "radius-print", value: "12pt" },
      ],
    };
    expect(nearestName("radius", 1, radii)).toBe("radius-none");
    expect(nearestName("radius", "0px", radii)).toBe("radius-none");
    // 12pt is 16px.
    expect(nearestToken("radius", "15px", radii)).toMatchObject({
      distance: 1,
      name: "radius-print",
    });
  });

  it("is the weight and the unitless line height nearest as numbers", () => {
    expect(nearestName("fontWeight", 600, ds)).toBe("font-weight-bold");
    expect(nearestName("fontWeight", "300", ds)).toBe("font-weight-normal");
    expect(nearestName("leading", 1.4, ds)).toBe("leading-tight");
    expect(nearestName("leading", "1.8", ds)).toBe("leading-loose");
  });

  it("is none for a font family or a shadow, which have no measure of nearness", () => {
    expect(nearestToken("font", "Inter", ds)).toBeNull();
    expect(nearestToken("shadow", "0 1px 3px black", ds)).toBeNull();
  });

  it("is none for a value it cannot measure, or a kind with no tokens", () => {
    expect(nearestToken("radius", "50%", ds)).toBeNull();
    expect(nearestToken("color", "var(--x)", ds)).toBeNull();
    expect(nearestToken("tracking", "0.01em", ds)).toBeNull();
  });
});
