import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { withHeldSize } from "./node-sizing.ts";

const title = { id: "title", text: "Welcome", type: "text" } as DesignNode;
const header = { children: [title], id: "header", type: "row" } as DesignNode;
const root = { children: [header], id: "root", type: "page" } as DesignNode;

describe("an element held at the size its corner is dragged to", () => {
  it("is drawn at that size, inside the page", () => {
    const drawn = withHeldSize(root, {
      height: 40,
      nodeId: "title",
      width: 220,
    });
    expect(drawn).toMatchObject({
      children: [{ children: [{ height: 40, id: "title", width: 220 }] }],
    });
  });

  it("leaves the tree as it is when nothing is held, or the element is not in it", () => {
    expect(withHeldSize(root, undefined)).toBe(root);
    expect(withHeldSize(root, { height: 1, nodeId: "gone", width: 1 })).toBe(
      root
    );
  });
});

describe("a stack held at the spacing its band is dragged to (ADR 0145)", () => {
  it("is drawn with that gap or padding, its other fields as they were", () => {
    expect(withHeldSize(root, { gap: 24, nodeId: "header" })).toMatchObject({
      children: [{ gap: 24, id: "header" }],
    });
    const padded = withHeldSize(root, {
      nodeId: "root",
      padding: { left: 8, top: 16 },
    });
    expect(padded).toMatchObject({ padding: { left: 8, top: 16 } });
    expect(padded).not.toHaveProperty("width");
  });

  it("draws a layer of an instance with it as the instance's override (ADR 0114)", () => {
    const page = {
      children: [
        { component: "Promo", from: "#app", id: "promo", type: "instance" },
      ],
      id: "root",
      type: "page",
    } as DesignNode;
    expect(withHeldSize(page, { gap: 12, nodeId: "promo/bar" })).toMatchObject({
      children: [{ id: "promo", overrides: { bar: { gap: 12 } } }],
    });
    // An instance the page no longer has: drawn as it is.
    expect(withHeldSize(page, { gap: 12, nodeId: "gone/bar" })).toBe(page);
  });
});
