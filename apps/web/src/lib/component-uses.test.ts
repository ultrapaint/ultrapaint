import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { componentUsesOf, instanceCountOf } from "./component-uses.ts";

const button = (id: string): DesignNode => ({
  component: "Button",
  from: "@ultrapaint/system",
  id,
  type: "instance",
});

const page = (children: DesignNode[]): DesignNode => ({
  children,
  id: "root",
  type: "page",
});

const CARD: ComponentFile = {
  name: "Card",
  origin: "app",
  properties: [],
  slots: [],
  tree: { children: [button("cta")], id: "c", type: "column" },
  version: 1,
};

describe("where a component is used", () => {
  it("counts each page's instances, the most first, then the app components placing it", () => {
    const uses = componentUsesOf("Button", "@ultrapaint/system", {
      components: [CARD],
      pages: [
        { name: "Pricing", root: page([button("a")]) },
        { name: "Empty", root: page([]) },
        {
          name: "Orders",
          root: page([
            button("b"),
            { children: [button("c")], id: "row", type: "row" },
          ]),
        },
        { name: "Unread", root: null },
      ],
    });
    expect(uses).toEqual([
      { count: 2, kind: "page", name: "Orders" },
      { count: 1, kind: "page", name: "Pricing" },
      { count: 1, kind: "component", name: "Card" },
    ]);
  });

  it("tells a component by where it is imported from, and not its own tree", () => {
    expect(
      componentUsesOf("Button", "#app", {
        components: [CARD],
        pages: [{ name: "Pricing", root: page([button("a")]) }],
      })
    ).toEqual([]);
    expect(
      componentUsesOf("Card", "#app", { components: [CARD], pages: [] })
    ).toEqual([]);
  });

  it("adds up the instances the pages and the app components place", () => {
    expect(
      instanceCountOf("Button", "@ultrapaint/system", {
        components: [CARD],
        pages: [
          { name: "Pricing", root: page([button("a"), button("b")]) },
          { name: "Unread", root: null },
        ],
      })
    ).toBe(3);
    expect(
      instanceCountOf("Card", "#app", { components: [CARD], pages: [] })
    ).toBe(0);
  });
});
