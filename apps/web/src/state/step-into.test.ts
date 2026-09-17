import type { TreeNode } from "@ultrapaint/contracts/preview";
import { describe, expect, it } from "vitest";
import { stepInto } from "./tree.ts";

const node = (id: string, children: TreeNode[] = []): TreeNode => ({
  children,
  editable: false,
  id,
  kind: "element",
  name: id,
  source: null,
  summary: id,
});

/** A screen holding an open menu: one popup, a list, and two items of one row each. */
const tree = node("root", [
  node("card", [node("trigger")]),
  node("popup", [
    node("list", [
      node("item1", [node("label1")]),
      node("item2", [node("label2")]),
    ]),
  ]),
]);

const chain1 = ["popup", "list", "item1", "label1"];
const chain2 = ["popup", "list", "item2", "label2"];

describe("what a click on the canvas takes", () => {
  it("takes the outermost node the preview offers when nothing is selected", () => {
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

  it("answers with nothing when the point is on nothing", () => {
    expect(stepInto([], tree, "popup", false)).toBeNull();
  });
});
