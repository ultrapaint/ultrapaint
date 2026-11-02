import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { systemComponentOf } from "@ultrapaint/system-components/catalogue";
import { describe, expect, it } from "vitest";
import {
  offeredStarters,
  STARTERS,
  starterPrompt,
  starterTheme,
} from "./starters.ts";

const system = (over: Partial<DesignSystem> = {}): DesignSystem => ({
  colors: [],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
  ...over,
});

const ids = (offered: ReturnType<typeof offeredStarters>) =>
  offered.map((o) => o.starter.id);

describe("the starters an empty canvas offers", () => {
  it("are the first four, plain without a design system", () => {
    const offered = offeredStarters(false);
    expect(ids(offered)).toEqual(STARTERS.slice(0, 4).map((s) => s.id));
    expect(offered.every((o) => o.uses.length === 0)).toBe(true);
  });

  it("name system components only, which every project has", () => {
    const named = STARTERS.flatMap((s) => s.uses);
    expect(named.filter((name) => !systemComponentOf(name))).toEqual([]);
    expect(offeredStarters(true)[0]?.uses).toEqual(["Button", "Card", "Badge"]);
  });
});

describe("a starter's prompt", () => {
  it("names the canvas and the components, and is left for the user to finish", () => {
    const [landing] = offeredStarters(true);
    expect(landing && starterPrompt(landing, "Marketing", true)).toBe(
      "Design a landing page with a navigation bar, a hero with a call to action and three feature cards on the Marketing canvas, with the design system's Button, Card and Badge. It is for "
    );
  });

  it("asks for a plain wireframe without a design system", () => {
    const [landing] = offeredStarters(false);
    expect(landing && starterPrompt(landing, "Home", false)).toContain(
      "on the Home canvas, as a plain wireframe."
    );
  });
});

describe("the look of the thumbnails", () => {
  it("takes the roles' colours, the middle of a scale when there is no plain token", () => {
    const theme = starterTheme(
      system({
        colors: [
          {
            name: "Semantic",
            tokens: [
              { name: "color-background-100", value: "#eee" },
              { name: "color-background-200", value: "#fff" },
              { name: "color-foreground", value: "#111" },
              { name: "color-primary-100", value: "#ddf" },
              { name: "color-primary-700", value: "#33f" },
              { name: "color-primary-900", value: "#118" },
            ],
          },
        ],
      })
    );
    expect(theme.accent).toBe("#33f");
    expect(theme.foreground).toBe("#111");
    expect(theme.surface).toBe("#eee");
    expect(theme.card).toBe("#eee");
  });

  it("draws the radius at half size, and the heading font by its first family", () => {
    const theme = starterTheme(
      system({
        radius: [
          { name: "radius-full", value: "9999px" },
          { name: "radius-lg", value: "0.625rem" },
        ],
        typography: {
          fonts: [
            { name: "font-body", value: "Inter, sans-serif" },
            {
              name: "font-heading",
              value: '"Plus Jakarta Sans Variable", ui-sans-serif',
            },
          ],
          sizes: [],
          styles: [],
          weights: [],
        },
      })
    );
    expect(theme.radius).toBe(5);
    expect(theme.font?.name).toBe("Plus Jakarta Sans Variable");
  });
});
