import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { mixName, putPart } from "./variation-parts.ts";

const text = (id: string, words: string, extra: object = {}) =>
  ({ id, text: words, type: "text", ...extra }) as DesignNode;
const column = (id: string, children: DesignNode[], extra: object = {}) =>
  ({ children, id, type: "column", ...extra }) as DesignNode;

/** The ids of a tree, as nested lists: what goes where. */
const shape = (node: DesignNode): unknown =>
  "children" in node && node.children
    ? [node.id, (node.children as DesignNode[]).map(shape)]
    : node.id;

const wordsOf = (root: DesignNode, id: string): string | undefined => {
  const found = (n: DesignNode): DesignNode | undefined =>
    n.id === id
      ? n
      : (("children" in n ? n.children : []) as DesignNode[] | undefined)
          ?.map(found)
          .find(Boolean);
  const node = found(root);
  return node?.type === "text" ? node.text : undefined;
};

// The preview: a hero with a title and a lede.
const preview = column("hero", [
  text("title", "Notes"),
  text("lede", "Write it down"),
]);
// Editorial: its title, a kicker the preview lacks, and the lede moved into a box.
const editorial = column("hero", [
  text("kicker", "Field notes"),
  text("title", "Notes, now and then"),
  column("box", [text("lede", "Slow down and write")]),
]);

describe("a part of a variation put in the preview (ADR 0098)", () => {
  it("in use in the preview: the preview's part with its id becomes it", () => {
    const put = putPart(preview, editorial, "title");
    expect(put.tree && wordsOf(put.tree, "title")).toBe("Notes, now and then");
    expect(put.how).toBe("use");
    expect(put.tree && shape(put.tree)).toEqual(["hero", ["title", "lede"]]);
  });

  it("added to the preview: a part it lacks lands at its place in the same parent", () => {
    const put = putPart(preview, editorial, "kicker");
    expect(put.how).toBe("add");
    expect(put.tree && shape(put.tree)).toEqual([
      "hero",
      ["kicker", "title", "lede"],
    ]);
  });

  it("moves a node of the preview whose id the part holds into the part, so each id is in one place", () => {
    const put = putPart(preview, editorial, "box");
    expect(put.tree && shape(put.tree)).toEqual([
      "hero",
      ["title", ["box", ["lede"]]],
    ]);
    expect(put.tree && wordsOf(put.tree, "lede")).toBe("Slow down and write");
  });

  it("cannot be added where the preview lacks its parent too, and says why", () => {
    const deeper = column("hero", [
      column("aside", [text("note", "PS")], { name: "Aside" }),
    ]);
    const put = putPart(preview, deeper, "note");
    expect(put.tree).toBeNull();
    expect(put.why).toBe("The preview has no Aside to put it in");
  });
});

describe("parts the variations nest the other way round", () => {
  const nested = (outer: string, inner: string, leaf: string) =>
    column("hero", [column(outer, [column(inner, [text(leaf, leaf)])])]);

  it("puts a part whose own node holds it in the preview in the part's parent", () => {
    // The preview has b inside a; the variation has a inside b.
    const put = putPart(nested("a", "b", "x"), nested("b", "a", "x"), "b");
    expect(put.tree && shape(put.tree)).toEqual([
      "hero",
      [["b", [["a", ["x"]]]]],
    ]);
  });

  it("cannot add a part whose parent the preview holds inside a node the part takes", () => {
    // The preview has p inside a; the variation has a inside q inside p.
    const drawn = column("hero", [column("a", [column("p", [])])]);
    const variation = column("hero", [
      column("p", [column("q", [column("a", [])])]),
    ]);
    const put = putPart(drawn, variation, "q");
    expect(put.how).toBe("none");
    expect(put.tree).toBeNull();
  });
});

describe("a parent the preview draws as a node that holds nothing", () => {
  it("takes no part, and says why", () => {
    // The preview has p as a text; the variation has it as a column holding x.
    const drawn = column("hero", [text("p", "Note")]);
    const variation = column("hero", [column("p", [text("x", "PS")])]);
    const put = putPart(drawn, variation, "x");
    expect(put.tree).toBeNull();
    expect(put.why).toBe("The preview's Note holds no parts");
  });
});

describe("an instance in the preview", () => {
  const instance = (id: string, children?: DesignNode[]) =>
    ({
      component: "Card",
      from: "app",
      id,
      ...(children ? { children } : {}),
      type: "instance",
    }) as unknown as DesignNode;

  it("takes a part where it is drawn with children of its own", () => {
    const drawn = column("hero", [instance("card", [text("a", "A")])]);
    const variation = column("hero", [
      instance("card", [text("a", "A"), text("b", "B")]),
    ]);
    expect(putPart(drawn, variation, "b").how).toBe("add");
  });

  it("takes none where it is drawn from its text alone", () => {
    const drawn = column("hero", [instance("card")]);
    const variation = column("hero", [instance("card", [text("b", "B")])]);
    expect(putPart(drawn, variation, "b").tree).toBeNull();
  });
});

describe("what the preview is made of", () => {
  it("is its variation with each part's variation and kind", () => {
    expect(
      mixName("Original", [
        {
          node: text("title", "x", { level: 1, role: "heading" }),
          variationName: "Editorial",
        },
      ])
    ).toBe("Original with Editorial's heading");
    expect(
      mixName("Original", [
        {
          node: column("box", [], { name: "Pull quote" }),
          variationName: "Loud",
        },
        { node: text("lede", "x"), variationName: "Calm" },
      ])
    ).toBe("Original with Loud's pull quote and Calm's paragraph");
    expect(
      mixName("Original", [
        { node: text("kicker", "x"), variationName: "Editorial" },
        { node: text("title", "x"), variationName: "Editorial" },
        { node: column("box", []), variationName: "Editorial" },
      ])
    ).toBe("Original with Editorial's paragraphs and column");
  });
});
