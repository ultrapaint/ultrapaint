import { describe, expect, it } from "vitest";
import { type Pick, pickId, pickOfId } from "./pick.ts";

const EVERY: readonly Pick[] = [
  { kind: "token", name: "color-primary-600" },
  { kind: "group", name: "primary" },
  { kind: "style", name: "Body" },
  { kind: "item", name: "Button" },
  {
    kind: "cell",
    place: { state: "hover", variant: { axis: "variant", member: "outline" } },
  },
  { kind: "cell", place: { state: null, variant: null } },
  { board: "tone=featured", kind: "variant" },
];

describe("a board's pick", () => {
  it("is read back from the id a board gives its node, of every kind", () => {
    expect(EVERY.map(pickId)).toEqual([
      "token:color-primary-600",
      "group:primary",
      "style:Body",
      "item:Button",
      "cell:variant=outline:hover",
      "cell:base:base",
      "variant:tone=featured",
    ]);
    for (const pick of EVERY) {
      expect(pickOfId(pickId(pick))).toEqual(pick);
    }
  });

  it("keeps a name with a colon in it whole", () => {
    expect(pickOfId("style:Heading: large")).toEqual({
      kind: "style",
      name: "Heading: large",
    });
  });

  it("is nothing for a node that stands for nothing, or a cell of no state", () => {
    for (const id of [
      "title:Button",
      "stage:Button",
      "corner",
      "cell:base:nope",
    ]) {
      expect(pickOfId(id), id).toBeNull();
    }
  });
});
