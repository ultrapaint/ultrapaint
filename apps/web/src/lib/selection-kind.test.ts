import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { selectionKindOf } from "./selection-kind.ts";

const text: DesignNode = {
  id: "label",
  role: "paragraph",
  text: "Hi",
  type: "text",
};

describe("the colour a selection takes", () => {
  it("is an element's for a plain node of a page", () => {
    expect(selectionKindOf(text)).toBe("element");
  });

  it("is a component's for a layer of an instance (ADR 0114)", () => {
    expect(selectionKindOf({ ...text, id: "shell/label" })).toBe("component");
  });

  it("is a component's for any node of a main component edited in place (ADR 0120)", () => {
    expect(selectionKindOf(text, true)).toBe("component");
  });

  it("is nobody's colour when nothing is there", () => {
    expect(selectionKindOf(null, true)).toBe("element");
  });
});
