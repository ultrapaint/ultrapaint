import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { changedNodes, withChangedNodes } from "./patch.ts";
import { childrenOf } from "./tree.ts";

const text = (id: string, t: string) =>
  ({ id, text: t, type: "text" }) as DesignNode;
const page = (...sections: DesignNode[]) =>
  ({ children: sections, id: "page", type: "page" }) as DesignNode;
const section = (id: string, ...kids: DesignNode[]) =>
  ({ children: kids, id, type: "column" }) as DesignNode;

const big = page(
  section("a", text("a1", "One"), text("a2", "Two"), text("a3", "Three")),
  section("b", text("b1", "Four"), text("b2", "Five"), text("b3", "Six")),
  section("c", text("c1", "Seven"), text("c2", "Eight"))
);

/** The tree `next` is, as the editor's copy of `prev` takes its changed nodes. */
const roundTrip = (prev: DesignNode, next: DesignNode) => {
  const nodes = changedNodes(prev, next);
  return { nodes, tree: nodes && withChangedNodes(prev, next.id, nodes) };
};

describe("a document's changed nodes", () => {
  it("are the one text edited, the rest kept as the objects they were", () => {
    const next = page(
      childrenOf(big)[0] as DesignNode,
      section(
        "b",
        text("b1", "Four"),
        text("b2", "Changed"),
        text("b3", "Six")
      ),
      childrenOf(big)[2] as DesignNode
    );
    const { nodes, tree } = roundTrip(big, next);
    expect(nodes).toEqual([
      { node: { id: "b2", text: "Changed", type: "text" } },
    ]);
    expect(tree).toEqual(next);
    const [a, b, c] = tree ? childrenOf(tree) : [];
    const [pa, pb, pc] = childrenOf(big);
    expect(a).toBe(pa);
    expect(c).toBe(pc);
    expect(b).not.toBe(pb);
    expect(b && childrenOf(b)[0]).toBe(pb && childrenOf(pb)[0]);
  });

  it("say a move and a removal by the children their parents hold, a new node in full", () => {
    const next = page(
      section("a", text("a1", "One"), text("b3", "Six"), text("new", "Hi")),
      section("b", text("b1", "Four"), text("b2", "Five")),
      section("c", text("c1", "Seven"), text("c2", "Eight"))
    );
    const { nodes, tree } = roundTrip(big, next);
    expect(nodes?.map((n) => [n.node.id, n.children])).toEqual([
      ["a", ["a1", "b3", "new"]],
      ["new", undefined],
      ["b", ["b1", "b2"]],
    ]);
    expect(tree).toEqual(next);
  });

  it("are the whole tree when they would say as much, or ids repeat", () => {
    expect(changedNodes(big, page(text("x", "All new")))).toBeNull();
    expect(
      changedNodes(big, page(section("a", text("t", "1")), text("t", "2")))
    ).toBeNull();
  });

  it("go into no copy that lacks a node they keep or that they name twice: the hash says the rest", () => {
    const next = page(
      section("a", text("a1", "One"), text("other", "x")),
      childrenOf(big)[1] as DesignNode,
      childrenOf(big)[2] as DesignNode
    );
    const nodes = changedNodes(big, next) ?? [];
    const another = page(section("a", text("a1", "One")));
    expect(withChangedNodes(another, "page", nodes)).not.toBeNull();
    // A node they keep that the copy does not have.
    expect(
      withChangedNodes(another, "page", [
        { children: ["a", "b"], node: { id: "page", type: "page" } },
      ])
    ).toBeNull();
    expect(
      withChangedNodes(big, "page", [
        { children: ["a", "a"], node: { id: "page", type: "page" } },
      ])
    ).toBeNull();
  });

  it("leave a tree that did not change as it was", () => {
    expect(changedNodes(big, JSON.parse(JSON.stringify(big)))).toEqual([]);
    expect(withChangedNodes(big, "page", [])).toBe(big);
  });
});
