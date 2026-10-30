import type { ComponentFile } from "@ultrapaint/contracts/components";
import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { applyEdits } from "@ultrapaint/design-document/design-system-edits";
import { describe, expect, it } from "vitest";
import {
  ownValueIn,
  paletteOf,
  rampEdits,
  textStyleOp,
  usesOf,
  valueOp,
} from "./token-ops.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "primary",
      tokens: [
        { name: "color-primary-50", value: "#eff6ff" },
        {
          name: "color-primary-600",
          value: "#2563eb",
          values: { dark: "#60a5fa" },
        },
      ],
    },
    { name: "Semantic", tokens: [{ name: "color-brand", value: "#ff0000" }] },
  ],
  themes: ["light", "dark"],
  typography: {
    fonts: [],
    sizes: [],
    styles: [
      {
        name: "Lead",
        role: "paragraph",
        size: 18,
        weight: "$font-weight-bold",
      },
      { color: "$color-brand", name: "Loud", role: "paragraph" } as never,
    ],
    weights: [],
  },
};

describe("a token's fields as operations", () => {
  it("sets the default theme's value plainly and another theme's by name", () => {
    expect(valueOp(ds, "color-brand", "light", "#000")).toEqual({
      name: "color-brand",
      op: "setValue",
      value: "#000",
    });
    expect(valueOp(ds, "color-brand", "dark", null)).toEqual({
      name: "color-brand",
      op: "setValue",
      theme: "dark",
      value: null,
    });
    expect(ownValueIn(ds, "color-primary-600", "dark")).toBe("#60a5fa");
    expect(ownValueIn(ds, "color-brand", "dark")).toBeUndefined();
  });

  it("sets a text style's setting, and takes it out with nothing", () => {
    const [lead] = ds.typography.styles;
    expect(textStyleOp(lead as never, "weight", 500)).toEqual({
      op: "setTextStyle",
      style: { name: "Lead", role: "paragraph", size: 18, weight: 500 },
    });
    expect(textStyleOp(lead as never, "size", null)).toEqual({
      op: "setTextStyle",
      style: { name: "Lead", role: "paragraph", weight: "$font-weight-bold" },
    });
  });
});

describe("Generate ramp from…", () => {
  it("fills a shade's palette in its group, light to dark and the dark theme the other way", () => {
    expect(paletteOf(ds, "color-primary-600")).toEqual({
      exists: true,
      group: "primary",
      prefix: "color-primary",
    });
    const made = rampEdits(ds, "color-primary-600", "#2563eb");
    expect(made?.shades.map((s) => s.name)).toHaveLength(11);
    const edited = applyEdits(ds, made?.ops ?? []);
    if ("problem" in edited) {
      throw new Error(edited.problem);
    }
    const group = edited.colors.find((g) => g.name === "primary");
    expect(group?.tokens.map((t) => t.name)).toEqual([
      "color-primary-50",
      "color-primary-100",
      "color-primary-200",
      "color-primary-300",
      "color-primary-400",
      "color-primary-500",
      "color-primary-600",
      "color-primary-700",
      "color-primary-800",
      "color-primary-900",
      "color-primary-950",
    ]);
    const shade600 = tokenOf(edited, "color-primary-600");
    expect(shade600?.value).toBe("#2563eb");
    // The dark theme's 50 is the light theme's 950.
    expect(tokenOf(edited, "color-primary-50")?.values?.dark).toBe(
      tokenOf(edited, "color-primary-950")?.value
    );
  });

  it("makes a palette of a colour's own name in a group of it", () => {
    const made = rampEdits(ds, "color-brand", "#ff0000");
    expect(made?.palette).toEqual({
      exists: false,
      group: "brand",
      prefix: "color-brand",
    });
    expect(made?.ops[0]).toEqual({ name: "brand", op: "addGroup" });
    const edited = applyEdits(ds, made?.ops ?? []);
    expect("problem" in edited).toBe(false);
    expect(rampEdits(ds, "color-brand", "var(--x)")).toBeNull();
  });
});

describe("where a token is used", () => {
  const page: DesignNode = {
    children: [
      { children: [], fill: "$color-brand", id: "a", type: "row" },
      {
        id: "b",
        role: "paragraph",
        text: "Hi",
        textStyle: "Loud",
        type: "text",
      },
      { id: "c", role: "paragraph", text: "No", type: "text" },
    ],
    fill: "$color-brand",
    id: "root",
    type: "page",
  };
  it("counts a page's nodes, the components and the text styles that name it", () => {
    const button = {
      name: "Button",
      parts: { root: { fill: "$color-brand" } },
    } as unknown as ComponentFile;
    expect(
      usesOf("color-brand", {
        components: [button],
        ds,
        pages: [
          { name: "Home", root: page },
          { name: "Empty", root: null },
        ],
      })
    ).toEqual([
      { count: 3, kind: "page", name: "Home" },
      { count: 1, kind: "component", name: "Button" },
      { count: 1, kind: "style", name: "Loud" },
    ]);
  });
});
