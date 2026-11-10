import type { PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { isOffSystem, offSystemValues } from "./off-system.ts";

const page = (children: PageNode["children"], more: Partial<PageNode> = {}) =>
  ({ children, id: "root", type: "page", ...more }) as PageNode;

describe("values off the design system", () => {
  it("finds spacing off the scale's steps, and a design's own radius, colour and type where a token was due", () => {
    const found = offSystemValues(
      page(
        [
          {
            border: { color: "#e5e5e5", width: 1 },
            children: [],
            fill: "$color-card",
            gap: 11,
            id: "card",
            margin: { bottom: 10 },
            name: "Card",
            padding: { left: "$spacing-4", top: 19 },
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
        { padding: 19 }
      )
    );
    expect(found.map((f) => [f.node, f.field, f.kind, f.value])).toEqual([
      ["root", "padding", "spacing", 19],
      ["Card", "gap", "spacing", 11],
      ["Card", "radius", "radius", 14],
      ["Card", "padding.top", "spacing", 19],
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
          at: { md: { gap: 23 } },
          children: [],
          gap: "$spacing-4",
          id: "row",
          type: "row",
        },
      ])
    );
    expect(found.map((f) => [f.field, f.value])).toEqual([["at.md.gap", 23]]);
  });

  it("takes a spacing as on the scale where the editor writes it as a step: a whole one or a half", () => {
    // 10 on a 4px base is `gap-2.5`, 18 `p-4.5`; 11 has no step, and is written `gap-[11px]`.
    expect(isOffSystem("spacing", 10)).toBe(false);
    expect(isOffSystem("spacing", 18)).toBe(false);
    expect(isOffSystem("spacing", -10)).toBe(false);
    expect(isOffSystem("spacing", 11)).toBe(true);
    expect(isOffSystem("spacing", 3, 2)).toBe(false);
    expect(isOffSystem("spacing", 2.5, 2)).toBe(true);
  });

  it("leaves 0, the keywords that are no value, sizes, a round radius and an instance's props alone", () => {
    expect(isOffSystem("spacing", 0)).toBe(false);
    expect(isOffSystem("spacing", 16)).toBe(false);
    expect(isOffSystem("spacing", 19)).toBe(true);
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
