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
