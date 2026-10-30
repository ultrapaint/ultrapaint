import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { shareUnchanged, takesChildren } from "./tree.ts";

const instance = (children?: DesignNode[]): DesignNode => ({
  component: "Card",
  from: "@ultrapaint/system",
  id: "i",
  type: "instance",
  ...(children && { children }),
});

const label: DesignNode = {
  id: "t",
  role: "paragraph",
  text: "x",
  type: "text",
};

describe("takesChildren", () => {
  it("takes containers, and never text or images", () => {
    expect(
      takesChildren({ children: [], id: "g", type: "group" }, undefined)
    ).toBe(true);
    expect(takesChildren(label, { props: [{ name: "children" }] })).toBe(false);
  });

  it("takes an instance whose component declares children", () => {
    expect(takesChildren(instance(), { props: [{ name: "children" }] })).toBe(
      true
    );
    expect(takesChildren(instance(), { props: [{ name: "value" }] })).toBe(
      false
    );
  });

  it("takes an unknown component only when it already holds nodes", () => {
    expect(takesChildren(instance(), undefined)).toBe(false);
    expect(takesChildren(instance([label]), undefined)).toBe(true);
  });
});

describe("shareUnchanged", () => {
  const page = (title: string): DesignNode => ({
    children: [
      {
        children: [{ id: "t", role: "heading", text: title, type: "text" }],
        id: "head",
        type: "row",
      },
      {
        children: [{ id: "p", role: "paragraph", text: "Body", type: "text" }],
        id: "body",
        type: "column",
      },
    ],
    id: "root",
    type: "page",
  });

  it("keeps every node that did not change, and the whole tree when nothing did", () => {
    const before = page("Sale");
    expect(shareUnchanged(before, page("Sale"))).toBe(before);
    const after = shareUnchanged(before, page("Big sale")) as Extract<
      DesignNode,
      { type: "page" }
    >;
    expect(after).not.toBe(before);
    expect(after.children[1]).toBe(
      (before as Extract<DesignNode, { type: "page" }>).children[1]
    );
    expect(after.children[0]).not.toBe(
      (before as Extract<DesignNode, { type: "page" }>).children[0]
    );
    expect(after).toEqual(page("Big sale"));
  });
});
