import type { PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { isOffSystem, offSystemValues } from "./off-system.ts";

const page = (children: PageNode["children"], more: Partial<PageNode> = {}) =>
  ({ children, id: "root", type: "page", ...more }) as PageNode;

describe("values off the design system", () => {
  it("finds spacing off the base's steps, and a design's own radius, colour and type where a token was due", () => {
    const found = offSystemValues(
      page(
        [
          {
            border: { color: "#e5e5e5", width: 1 },
            children: [],
            fill: "$color-card",
            gap: 10,
            id: "card",
            margin: { bottom: 16 },
            name: "Card",
            padding: { left: "$spacing-4", top: 18 },
            radius: 14,
            type: "column",
          },
          {
            color: "oklch(0.4 0 0)",
            id: "t",
            role: "paragraph",
            size: 15,
            text: "Hi",
            type: "text",
            weight: 550,
          },
        ],
        { padding: 18 }
      )
    );
    expect(found.map((f) => [f.node, f.field, f.kind, f.value])).toEqual([
      ["root", "padding", "spacing", 18],
      ["Card", "gap", "spacing", 10],
      ["Card", "radius", "radius", 14],
      ["Card", "padding.top", "spacing", 18],
      ["Card", "border.color", "color", "#e5e5e5"],
      ["t", "color", "color", "oklch(0.4 0 0)"],
      ["t", "size", "text-size", 15],
      ["t", "weight", "weight", 550],
    ]);
  });

  it("checks a breakpoint's fields as the node's own", () => {
    const found = offSystemValues(
      page([
        {
          at: { md: { gap: 22 } },
          children: [],
          gap: "$spacing-4",
          id: "row",
          type: "row",
        },
      ])
    );
    expect(found.map((f) => [f.field, f.value])).toEqual([["at.md.gap", 22]]);
  });

  it("leaves 0, the keywords that are no value, sizes, a round radius and an instance's props alone", () => {
    expect(isOffSystem("spacing", 0)).toBe(false);
    expect(isOffSystem("spacing", 16)).toBe(false);
    expect(isOffSystem("spacing", 18)).toBe(true);
    expect(isOffSystem("spacing", 6, 2)).toBe(false);
    expect(isOffSystem("color", "transparent")).toBe(false);
    expect(isOffSystem("color", "currentColor")).toBe(false);
    expect(isOffSystem("radius", "50%")).toBe(false);
    expect(isOffSystem("spacing", "5%")).toBe(true);
    expect(
      offSystemValues(
        page([
          {
            children: [],
            height: 320,
            id: "box",
            type: "group",
            width: 480,
          },
        ])
      )
    ).toEqual([]);
  });
});
