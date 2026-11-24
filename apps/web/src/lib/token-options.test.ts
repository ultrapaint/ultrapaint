import "../testing/fake-browser.ts";
import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import {
  addTokens,
  SPACING_STEPS,
  tokenPrefix,
} from "@ultrapaint/contracts/token-table";
import {
  LOOK_PRESETS,
  lookSystem,
} from "@ultrapaint/design-document/look-dials";
import { describe, expect, it, vi } from "vitest";
import {
  FIELD_TOKEN_KINDS,
  splitPalettes,
  tokenOptions,
} from "./token-options.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** A design system with one token of every kind a field picks from, `<prefix>x`. */
const ds = addTokens(
  { ...emptyDesignSystem(), spacing: { base: "0.5rem" } },
  FIELD_TOKEN_KINDS.map((kind) => ({
    name: `${tokenPrefix(kind)}x`,
    value: kind === "font" ? '"Inter", sans-serif' : "1px",
  }))
);

describe("the pickers' options", () => {
  it.each(FIELD_TOKEN_KINDS.map((kind) => [kind] as const))(
    "offer the %s tokens by their short names",
    (kind) => {
      const option = tokenOptions(ds, kind).find(
        (o) => o.value === `$${tokenPrefix(kind)}x`
      );
      expect(option?.label).toBe("x");
    }
  );

  it("offer spacing as the scale's named steps over the base in pixels, then the named spacings", () => {
    const options = tokenOptions(ds, "spacing");
    expect(options.slice(0, 3)).toEqual([
      { description: "spacing-0", label: "0", value: "0" },
      { description: "spacing-0.5", label: "4", value: "4" },
      { description: "spacing-1", label: "8", value: "8" },
    ]);
    expect(options).toHaveLength(SPACING_STEPS.length + 1);
    expect(tokenOptions(null, "spacing")[2]?.value).toBe("4");
  });

  it("say which group a colour is of and the family a font is", () => {
    expect(tokenOptions(ds, "color")[0]?.description).toBe("Colors");
    expect(tokenOptions(ds, "font")[0]?.description).toBe("Inter");
    expect(tokenOptions(null, "radius")).toEqual([]);
  });
});

/** Colours named `<palette>-<step>` in a group of that name, each its own grey. */
const shades = (group: string, names: readonly string[]) => ({
  name: group,
  tokens: names.map((name, i) => ({
    name: `color-${name}`,
    value: `#${String(i).repeat(6)}`,
  })),
});

/** The labels of a split's list, and of each palette's places, `null` where a step is empty. */
const labelsOf = (system: DesignSystem) => {
  const { list, palettes } = splitPalettes(tokenOptions(system, "color"));
  return {
    list: list.map((o) => o.label),
    palettes: palettes.map((p) => ({
      name: p.name,
      shades: p.shades.map((o) => o?.label ?? null),
    })),
  };
};

describe("a colour field's palettes", () => {
  it("are the ramps of three shades or more, in step order, the other groups left in the list in their order", () => {
    const colors = {
      ...emptyDesignSystem(),
      colors: [
        shades("Semantic", ["primary", "background"]),
        shades("Blue", [
          "blue-950",
          "blue-50",
          "blue-100",
          "blue-200",
          "blue-300",
          "blue-400",
          "blue-500",
          "blue-600",
          "blue-700",
          "blue-800",
          "blue-900",
        ]),
        shades("Pair", ["pair-100", "pair-200"]),
        shades("Grey", ["grey-100", "grey-200", "grey-muted"]),
        shades("Sea", ["sky-100", "sea-100", "sea-200"]),
      ],
    };
    expect(labelsOf(colors)).toEqual({
      list: [
        "primary",
        "background",
        "pair-100",
        "pair-200",
        "grey-100",
        "grey-200",
        "grey-muted",
        "sky-100",
        "sea-100",
        "sea-200",
      ],
      palettes: [
        {
          name: "Blue",
          shades: [
            "blue-50",
            "blue-100",
            "blue-200",
            "blue-300",
            "blue-400",
            "blue-500",
            "blue-600",
            "blue-700",
            "blue-800",
            "blue-900",
            "blue-950",
          ],
        },
      ],
    });
  });

  it("keep an empty place at each step a palette is missing, so every place is one step across them", () => {
    const colors = {
      ...emptyDesignSystem(),
      colors: [shades("Red", ["red-900", "red-100", "red-500"])],
    };
    expect(labelsOf(colors).palettes).toEqual([
      {
        name: "Red",
        shades: [
          null,
          "red-100",
          null,
          null,
          null,
          "red-500",
          null,
          null,
          null,
          "red-900",
          null,
        ],
      },
    ]);
  });

  it("keep a palette at steps of its own, such as a chart's, as its shades in step order", () => {
    const colors = {
      ...emptyDesignSystem(),
      colors: [
        shades("Chart", ["chart-3", "chart-1", "chart-2"]),
        shades("Red", ["red-50", "red-500", "red-950"]),
      ],
    };
    expect(labelsOf(colors).palettes.map((p) => p.shades.length)).toEqual([
      3, 11,
    ]);
    expect(labelsOf(colors).palettes[0]?.shades).toEqual([
      "chart-1",
      "chart-2",
      "chart-3",
    ]);
  });

  it("leave a detailed preset's Text, Background and Border in the list", () => {
    const detailed = lookSystem({
      ...(LOOK_PRESETS[0] as (typeof LOOK_PRESETS)[number]).dials,
      tokens: "detailed",
    });
    const colors = {
      ...detailed,
      colors: [
        ...detailed.colors,
        shades("Teal", ["teal-100", "teal-500", "teal-900"]),
      ],
    };
    const { list, palettes } = splitPalettes(tokenOptions(colors, "color"));
    expect(new Set(list.map((o) => o.description))).toEqual(
      new Set(["Text", "Background", "Border"])
    );
    expect(palettes.map((p) => p.name)).toEqual(["Teal"]);
  });
});
