import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { describe, expect, it } from "vitest";
import { mapTargetsOf } from "./map-targets.ts";
import { SPACING_SCALE } from "./spacing.ts";

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
  it("offers each kind its tokens, the layers and the components", () => {
    expect(mapTargetsOf("color", ds, ["Button"])).toEqual(["color-primary"]);
    expect(mapTargetsOf("fontSize", ds, [])).toEqual(["text-sm"]);
    expect(mapTargetsOf("fontWeight", ds, [])).toEqual([
      "font-weight-semibold",
    ]);
    expect(mapTargetsOf("radius", ds, [])).toEqual(["radius-md"]);
    expect(mapTargetsOf("shadow", ds, [])).toEqual(["shadow-md"]);
    expect(mapTargetsOf("zIndex", ds, [])).toEqual(["50"]);
    expect(mapTargetsOf("element", ds, ["Button"])).toEqual(["Button"]);
  });

  it("offers a length the steps of the spacing scale before the spacing tokens", () => {
    expect(mapTargetsOf("spacing", ds, [])).toEqual([
      ...SPACING_SCALE.map((s) => `spacing-${s}`),
      "spacing-gutter",
    ]);
  });

  it("offers only the components before there is a design system", () => {
    expect(mapTargetsOf("element", null, ["Button"])).toEqual(["Button"]);
    expect(mapTargetsOf("spacing", null, ["Button"])).toEqual([]);
    expect(mapTargetsOf("color", null, ["Button"])).toEqual([]);
  });
});
