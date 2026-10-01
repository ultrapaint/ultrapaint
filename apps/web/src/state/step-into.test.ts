import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { stepInto, unlockedChain } from "./tree.ts";

const text = (id: string): DesignNode => ({
  id,
  role: "paragraph",
  text: id,
  type: "text",
});

const column = (id: string, children: DesignNode[]): DesignNode => ({
  children,
  id,
  type: "column",
});

/** A page with a card, and a list of two items of one label each. */
const tree: DesignNode = {
  children: [
    column("card", [text("trigger")]),
    column("popup", [
      column("list", [
        column("item1", [text("label1")]),
        column("item2", [text("label2")]),
      ]),
    ]),
  ],
  id: "root",
  type: "page",
};

const chain1 = ["root", "popup", "list", "item1", "label1"];
const chain2 = ["root", "popup", "list", "item2", "label2"];

describe("what a click on the canvas takes", () => {
  it("takes the outermost node under the page when nothing is selected", () => {
    expect(stepInto(chain1, tree, null, false)).toBe("popup");
  });

  it("goes one step in each time the same place is clicked again", () => {
    expect(stepInto(chain1, tree, "popup", false)).toBe("list");
    expect(stepInto(chain1, tree, "list", false)).toBe("item1");
    expect(stepInto(chain1, tree, "item1", false)).toBe("label1");
  });

  it("stays on the innermost node once there is nowhere further to go", () => {
    expect(stepInto(chain1, tree, "label1", false)).toBe("label1");
  });

  it("offers the neighbour at the depth already reached", () => {
    expect(stepInto(chain2, tree, "item1", false)).toBe("item2");
    expect(stepInto(chain2, tree, "label1", false)).toBe("item2");
  });

  it("starts over where the selection is somewhere else entirely", () => {
    expect(stepInto(chain1, tree, "trigger", false)).toBe("popup");
  });

  it("starts over where the selection is no longer in the tree", () => {
    expect(stepInto(chain1, tree, "gone", false)).toBe("popup");
  });

  it("goes straight to the innermost node with alt held", () => {
    expect(stepInto(chain1, tree, null, true)).toBe("label1");
    expect(stepInto(chain1, tree, "popup", true)).toBe("label1");
  });

  it("answers with nothing when the point is on nothing but the page", () => {
    expect(stepInto(["root"], tree, "popup", false)).toBeNull();
    expect(stepInto([], tree, "popup", false)).toBeNull();
  });

  it("keeps the root of a node on the canvas, which is a node like any other", () => {
    const free = column("free", [text("inside")]);
    expect(stepInto(["free", "inside"], free, null, false)).toBe("free");
    expect(stepInto(["free", "inside"], free, "free", false)).toBe("inside");
  });
});

describe("what the pointer passes by", () => {
  const locked = (node: DesignNode): DesignNode => ({ ...node, locked: true });

  it("leaves the chain as it is when nothing is locked", () => {
    expect(unlockedChain(chain1, tree)).toEqual(chain1);
  });

  it("stops short of a locked node and everything inside it", () => {
    const list = locked(
      column("list", [
        column("item1", [text("label1")]),
        column("item2", [text("label2")]),
      ])
    );
    const withLock: DesignNode = {
      children: [column("popup", [list])],
      id: "root",
      type: "page",
    };
    const chain = unlockedChain(chain1, withLock);
    expect(chain).toEqual(["root", "popup"]);
    // A click there takes the nearest node that is not locked.
    expect(stepInto(chain, withLock, null, true)).toBe("popup");
  });

  it("stops at the innermost when only that one is locked", () => {
    const withLock: DesignNode = {
      children: [column("card", [locked(text("trigger"))])],
      id: "root",
      type: "page",
    };
    expect(unlockedChain(["root", "card", "trigger"], withLock)).toEqual([
      "root",
      "card",
    ]);
  });

  it("leaves nothing of a locked node on the canvas", () => {
    const free = locked(column("free", [text("inside")]));
    const chain = unlockedChain(["free", "inside"], free);
    expect(chain).toEqual([]);
    expect(stepInto(chain, free, null, false)).toBeNull();
  });
});
