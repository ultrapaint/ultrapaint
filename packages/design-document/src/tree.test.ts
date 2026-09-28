import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { takesChildren } from "./tree.ts";

const instance = (children?: DesignNode[]): DesignNode => ({
  component: "Card",
  from: "@ui/card",
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
