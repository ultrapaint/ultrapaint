import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { describe, expect, it } from "vitest";
import { componentEntries, mirrorOf } from "./mirror.ts";

/** A shadcn theme on Tailwind v4, as the service hands it over: the code's values merged in. */
const shadcn = (): DesignSystem => {
  const ds = emptyDesignSystem();
  return {
    ...ds,
    colors: [
      {
        name: "Semantic",
        tokens: [
          {
            name: "color-background",
            value: "#ffffff",
            values: { dark: "#0a0a0a" },
          },
          { name: "color-primary", value: "oklch(0.205 0 0)" },
          { name: "color-ring", value: "var(--color-primary)" },
          { name: "color-chart", value: "var(--chart-1)" },
        ],
      },
    ],
    radius: [
      { name: "radius-sm", value: "calc(0.625rem - 4px)" },
      { name: "radius-lg", value: "0.625rem" },
      { name: "radius-full", value: "calc(infinity * 1px)" },
    ],
    spacing: { base: "0.25rem" },
    typography: {
      fonts: [
        { name: "font-sans", value: "ui-sans-serif, system-ui, sans-serif" },
        { name: "font-heading", value: "'Inter Variable', sans-serif" },
      ],
      sizes: [
        { lineHeight: "calc(2.5 / 2.25)", name: "text-4xl", value: "2.25rem" },
        { lineHeight: "calc(1.5 / 1)", name: "text-base", value: "1rem" },
      ],
      styles: [
        {
          font: "$font-heading",
          level: 1,
          name: "Heading xl",
          role: "heading",
          size: "$text-4xl",
          tracking: "$tracking-tight",
          weight: "$font-weight-bold",
        },
        { name: "Body", role: "paragraph", size: "$text-base" },
        {
          lineHeight: 20,
          name: "Caption",
          role: "paragraph",
          size: 12,
          weight: 500,
        },
      ],
      tracking: [{ name: "tracking-tight", value: "-0.025em" }],
      weights: [{ name: "font-weight-bold", value: "700" }],
    },
  };
};

describe("mirrorOf", () => {
  it("writes the design system's tokens as the format holds them", () => {
    const { groups, notes } = mirrorOf(shadcn());
    expect(groups.colors).toEqual({
      background: "#ffffff",
      primary: "oklch(0.205 0 0)",
      ring: "oklch(0.205 0 0)",
    });
    expect(groups.rounded).toEqual({
      full: "9999px",
      lg: "0.625rem",
      sm: "6px",
    });
    expect(groups.spacing).toEqual({ base: "0.25rem" });
    expect(groups.typography).toEqual({
      body: { fontFamily: "ui-sans-serif", fontSize: "1rem", lineHeight: 1.5 },
      caption: {
        fontFamily: "ui-sans-serif",
        fontSize: "12px",
        fontWeight: 500,
        lineHeight: "20px",
      },
      "heading-xl": {
        fontFamily: "Inter Variable",
        fontSize: "2.25rem",
        fontWeight: 700,
        letterSpacing: "-0.025em",
        lineHeight: 1.1111,
      },
    });
    expect(notes).toEqual([
      "color-chart: var(--chart-1) does not resolve to a value.",
    ]);
  });
});

describe("component tokens", () => {
  /** A stand-in for the style system: one class, one property. */
  const read = (classes: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const c of classes.split(" ")) {
      if (c.startsWith("bg-")) {
        out.backgroundColor = `$color-${c.slice(3)}`;
      } else if (c.startsWith("fg-")) {
        out.textColor = `$color-${c.slice(3)}`;
      } else if (c.startsWith("h-")) {
        out.height = c.slice(2);
      }
    }
    return out;
  };
  const button = {
    name: "IconButton",
    styles: {
      base: "fg-ink",
      classes: {
        size: { lg: "h-48px", sm: "h-32px" },
        variant: {
          danger: "bg-danger fg-white",
          default: "bg-primary",
          ghost: "",
        },
      },
      defaults: { size: "sm", variant: "default" },
    },
  };

  it("gives the component as it starts, each colour variant, and each size's dimensions", () => {
    expect(
      componentEntries(
        [button, { name: "Card" }],
        new Set(["IconButton"]),
        read
      )
    ).toEqual({
      "icon-button": {
        backgroundColor: "$color-primary",
        height: "32px",
        textColor: "$color-ink",
      },
      "icon-button-danger": {
        backgroundColor: "$color-danger",
        height: "32px",
        textColor: "$color-white",
      },
      "icon-button-ghost": { height: "32px", textColor: "$color-ink" },
      "icon-button-lg": { height: "48px" },
    });
    expect(componentEntries([button], new Set(), read)).toEqual({});
  });

  it("refers to the front matter's tokens, and writes the value of one it does not have", () => {
    const { groups, notes } = mirrorOf(shadcn(), {
      button: {
        backgroundColor: "$color-primary",
        height: "2.25rem",
        rounded: "$radius-lg",
        textColor: "$color-chart",
      },
      card: { backgroundColor: "$color-nowhere", padding: "50%" },
    });
    expect(groups.components).toEqual({
      button: {
        backgroundColor: "{colors.primary}",
        height: "2.25rem",
        rounded: "{rounded.lg}",
      },
    });
    expect(notes).toContain(
      "components.button.textColor: $color-chart is not a value DESIGN.md can hold."
    );
  });
});
