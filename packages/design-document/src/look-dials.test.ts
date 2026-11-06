import { DesignSystem } from "@ultrapaint/contracts/design-system";
import { valueInTheme } from "@ultrapaint/contracts/themes";
import { contrastRatio } from "@ultrapaint/contracts/token-value";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  LOOK_PRESETS,
  type LookDials,
  lookSystem,
  presetOf,
} from "./look-dials.ts";
import { designTokenCss } from "./tokens.ts";

const calm = (LOOK_PRESETS[0] as { dials: LookDials }).dials;

describe("a look made from the dials", () => {
  it("is a design system the format accepts, for every preset", () => {
    for (const preset of LOOK_PRESETS) {
      expect(() =>
        Schema.decodeUnknownSync(DesignSystem)(lookSystem(preset.dials))
      ).not.toThrow();
    }
  });

  it("puts the brand on the main action, its text readable in light and dark", () => {
    for (const brand of ["#1f7a52", "#fde047", "#111827"]) {
      const ds = lookSystem({ ...calm, brand });
      for (const theme of ["light", "dark"]) {
        const fill = valueInTheme(ds, "color-primary", theme) ?? "";
        const ink = valueInTheme(ds, "color-primary-foreground", theme) ?? "";
        expect(contrastRatio(ink, fill)).toBeGreaterThan(4.5);
      }
      expect(valueInTheme(ds, "color-primary", "light")).toBe(brand);
    }
  });

  it("keeps its text readable on its background in both themes", () => {
    for (const preset of LOOK_PRESETS) {
      const ds = lookSystem(preset.dials);
      for (const theme of ["light", "dark"]) {
        const on = (name: string) =>
          contrastRatio(
            valueInTheme(ds, name, theme) ?? "",
            valueInTheme(ds, "color-background", theme) ?? ""
          ) ?? 0;
        expect(on("color-foreground")).toBeGreaterThan(13);
        const edge = contrastRatio(
          valueInTheme(ds, "color-input", theme) ?? "",
          valueInTheme(ds, "color-card", theme) ?? ""
        );
        expect(edge).toBeGreaterThanOrEqual(3);
        expect(on("color-muted-foreground")).toBeGreaterThan(4.5);
      }
    }
  });

  it("sets the corners, the density and the face it was given", () => {
    const ds = lookSystem({
      ...calm,
      corners: "sharp",
      density: "compact",
      typeface: "Inter",
    });
    expect(ds.radius.find((t) => t.name === "radius-md")?.value).toBe(
      "0.25rem"
    );
    expect(ds.spacing.base).toBe("0.225rem");
    expect(ds.typography.fonts[0]?.value).toContain('"Inter"');
    expect(ds.typography.fonts[0]?.source).toContain("family=Inter");
  });

  it("names its colours by property and meaning in the detailed preset, the stroke the look's", () => {
    const ds = lookSystem({ ...calm, iconStroke: "bold", tokens: "detailed" });
    expect(ds.tokenPreset).toBe("detailed");
    expect(ds.colors.map((g) => g.name)).toEqual([
      "Text",
      "Background",
      "Border",
    ]);
    expect(valueInTheme(ds, "background-color-brand-bold", "light")).toBe(
      calm.brand
    );
    expect(ds.icons?.stroke).toBe(2.5);
    const css = designTokenCss(ds);
    expect(css).toContain(
      "--color-primary: var(--background-color-brand-bold);"
    );
    expect(css).toContain("--icon-stroke: 2.5;");
  });

  it("keeps its type above the floors at every density: captions 13px, interface text 14px", () => {
    for (const density of ["compact", "regular", "open"] as const) {
      const { sizes } = lookSystem({ ...calm, density }).typography;
      const px = (name: string) =>
        Number.parseFloat(sizes.find((t) => t.name === name)?.value ?? "0") *
        16;
      expect(px("text-xs")).toBeGreaterThanOrEqual(13);
      expect(px("text-sm")).toBeGreaterThanOrEqual(14);
    }
  });

  it("knows the preset its dials are, and none once one is changed", () => {
    expect(presetOf(calm)?.name).toBe("Calm");
    expect(presetOf({ ...calm, corners: "round" })).toBeUndefined();
    expect(presetOf({ ...calm, tokens: "detailed" })?.name).toBe("Calm");
  });
});
