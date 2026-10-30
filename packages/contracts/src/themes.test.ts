import { describe, expect, it } from "vitest";
import { type DesignSystem, emptyDesignSystem } from "./design-system.ts";
import {
  defaultTheme,
  isDarkTheme,
  themeSelector,
  themesOf,
  valueInTheme,
} from "./themes.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "Semantic",
      tokens: [
        {
          name: "color-blue-600",
          value: "#2563eb",
          values: { night: "#60a5fa" },
        },
        { name: "color-primary", value: "var(--color-blue-600)" },
        { name: "color-link", value: "$color-primary" },
        { name: "color-a", value: "var(--color-b)" },
        { name: "color-b", value: "var(--color-a)" },
      ],
    },
  ],
  themes: ["day", "night"],
};

describe("a design system's themes", () => {
  it("are its own, the first the default, or light alone when it names none", () => {
    expect(themesOf(ds)).toEqual(["day", "night"]);
    expect(defaultTheme(ds)).toBe("day");
    expect(themesOf(emptyDesignSystem())).toEqual(["light"]);
    expect(defaultTheme(emptyDesignSystem())).toBe("light");
  });

  it("give a token's value in a theme, the default's where it has none", () => {
    expect(valueInTheme(ds, "color-blue-600", "night")).toBe("#60a5fa");
    expect(valueInTheme(ds, "color-blue-600", "day")).toBe("#2563eb");
    expect(valueInTheme(ds, "color-primary", "night")).toBe(
      "var(--color-blue-600)"
    );
    expect(valueInTheme(ds, "color-none", "day")).toBeUndefined();
  });

  it("follow a token that names another, in the same theme, and never round a cycle", () => {
    expect(valueInTheme(ds, "color-link", "night", { follow: true })).toBe(
      "#60a5fa"
    );
    expect(valueInTheme(ds, "color-primary", "day", { follow: true })).toBe(
      "#2563eb"
    );
    expect(valueInTheme(ds, "color-a", "day", { follow: true })).toBe(
      "var(--color-a)"
    );
  });

  it("apply under a theme's class and data-theme, and say which are dark", () => {
    expect(themeSelector("dark")).toBe('.dark, [data-theme~="dark"]');
    expect(themeSelector("high contrast")).toBe(
      '.highcontrast, [data-theme~="highcontrast"]'
    );
    expect(isDarkTheme("Dark")).toBe(true);
    expect(isDarkTheme("dark-dimmed")).toBe(true);
    expect(isDarkTheme("light")).toBe(false);
  });
});
