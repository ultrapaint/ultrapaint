import {
  APP_FROM,
  type AppComponentFile,
  emptySystemComponent,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/components";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { designTokenCss, tokensIn, tokensUsed } from "./tokens.ts";

describe("the tokens a design relies on", () => {
  it("finds every token a value names, however deep, and the spacing behind a step", () => {
    expect([
      ...tokensIn({
        border: { color: "$color-border", width: 1 },
        fill: "$color-primary",
        gap: "$spacing-4",
        text: "costs $5",
      }),
    ]).toEqual(["color-border", "color-primary", "spacing-4", "spacing"]);
  });

  it("takes a named spacing for itself, not for a step of the base", () => {
    expect([
      ...tokensIn({ gap: "$spacing-4x", padding: "$spacing-gutter" }),
    ]).toEqual(["spacing-4x", "spacing-gutter"]);
    expect([...tokensIn("$spacing-2.5")]).toEqual(["spacing-2.5", "spacing"]);
  });

  it("takes in the text styles its texts are set in, the looks it owns and its app components' trees", () => {
    const page: PageNode = {
      children: [
        {
          id: "t",
          role: "heading",
          text: "Hi",
          textStyle: "Title",
          type: "text",
        },
        { component: "Button", from: SYSTEM_FROM, id: "b", type: "instance" },
        { component: "Badge", from: SYSTEM_FROM, id: "c", type: "instance" },
        { component: "Plan", from: APP_FROM, id: "p", type: "instance" },
      ],
      fill: "$color-surface",
      id: "root",
      type: "page",
    };
    const ds = {
      ...emptyDesignSystem(),
      typography: {
        ...emptyDesignSystem().typography,
        styles: [
          {
            name: "Title",
            role: "heading" as const,
            size: "$text-2xl",
            weight: "$font-weight-bold",
          },
        ],
      },
    };
    const button = {
      ...emptySystemComponent("Button"),
      base: { root: { fill: "$color-brand" } },
    };
    // An app component's tree, and the looks of what it places.
    const plan: AppComponentFile = {
      name: "Plan",
      origin: "app",
      properties: [],
      slots: [],
      tree: {
        children: [
          { component: "Card", from: SYSTEM_FROM, id: "k", type: "instance" },
        ],
        gap: "$spacing-gap",
        id: "r",
        type: "row",
      },
      version: 1,
    };
    const card = {
      ...emptySystemComponent("Card"),
      base: { root: { radius: "$radius-xl" } },
    };
    expect([...tokensUsed(page, ds, [button, plan, card])].sort()).toEqual([
      "color-brand",
      "color-surface",
      "font-weight-bold",
      "radius-xl",
      "spacing-gap",
      "text-2xl",
    ]);
  });
});

describe("the design's tokens as CSS", () => {
  it("gives every colour in every theme, the default's where a theme has none of its own", () => {
    const css = designTokenCss({
      ...emptyDesignSystem(),
      colors: [
        {
          name: "Semantic",
          tokens: [
            { name: "color-primary", value: "#2563eb" },
            { name: "color-bg", value: "#fff", values: { dark: "#000" } },
          ],
        },
      ],
      radius: [{ name: "radius-md", value: "0.5rem" }],
      themes: ["light", "dark"],
    });
    expect(css).toBe(
      [
        ":host {\n  --spacing: 0.25rem;\n  --color-primary: #2563eb;\n  --color-bg: #fff;\n  --radius-md: 0.5rem;\n}",
        '.dark, [data-theme~="dark"] {\n  --color-primary: #2563eb;\n  --color-bg: #000;\n}',
      ].join("\n\n")
    );
  });
});
