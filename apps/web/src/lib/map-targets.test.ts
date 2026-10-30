import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { SPACING_STEPS } from "@ultrapaint/contracts/token-table";
import { describe, expect, it } from "vitest";
import { mapTargetsOf } from "./map-targets.ts";

const token = (name: string) => ({ name, value: "1" });

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [{ name: "Brand", tokens: [token("color-primary")] }],
  elevation: [
    { description: "", name: "Base" },
    { description: "", layer: 50, name: "Overlay" },
  ],
  radius: [token("radius-md")],
  shadows: [token("shadow-md")],
  spacing: { base: "0.25rem", tokens: [token("spacing-gutter")] },
  typography: {
    fonts: [],
    sizes: [token("text-sm")],
    styles: [],
    weights: [token("font-weight-semibold")],
  },
};

describe("mapTargetsOf", () => {
  it("offers each kind its tokens and the layers", () => {
    expect(mapTargetsOf("color", ds)).toEqual(["color-primary"]);
    expect(mapTargetsOf("fontSize", ds)).toEqual(["text-sm"]);
    expect(mapTargetsOf("fontWeight", ds)).toEqual(["font-weight-semibold"]);
    expect(mapTargetsOf("radius", ds)).toEqual(["radius-md"]);
    expect(mapTargetsOf("shadow", ds)).toEqual(["shadow-md"]);
    expect(mapTargetsOf("zIndex", ds)).toEqual(["50"]);
  });

  it("offers a length the steps of the spacing scale before the spacing tokens", () => {
    expect(mapTargetsOf("spacing", ds)).toEqual([
      ...SPACING_STEPS.map((s) => `spacing-${s}`),
      "spacing-gutter",
    ]);
  });

  it("offers nothing before there is a design system", () => {
    expect(mapTargetsOf("spacing", null)).toEqual([]);
    expect(mapTargetsOf("color", null)).toEqual([]);
  });
});
