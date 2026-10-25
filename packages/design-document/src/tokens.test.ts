import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { PageNode } from "@ultrapaint/contracts/document";
import { emptySpec } from "@ultrapaint/contracts/specs";
import { describe, expect, it } from "vitest";
import { tokensIn, tokensUsed } from "./tokens.ts";

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

  it("takes in the text styles its texts are set in and the specs whose look it owns", () => {
    const page: PageNode = {
      children: [
        {
          id: "t",
          role: "heading",
          text: "Hi",
          textStyle: "Title",
          type: "text",
        },
        { component: "Button", from: "@ui/button", id: "b", type: "instance" },
        { component: "Badge", from: "@ui/badge", id: "c", type: "instance" },
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
      ...emptySpec("Button", "@ui/button", "design"),
      base: { root: { fill: "$color-brand" } },
    };
    // A spec that mirrors the code says what the code's classes use: the code's own.
    const badge = {
      ...emptySpec("Badge", "@ui/badge", "code"),
      base: { root: { fill: "$color-muted" } },
    };
    expect([...tokensUsed(page, ds, [button, badge])].sort()).toEqual([
      "color-brand",
      "color-surface",
      "font-weight-bold",
      "text-2xl",
    ]);
  });
});
