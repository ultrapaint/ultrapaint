import { describe, expect, it } from "vitest";
import { takeNameOf, targetOfRef, variationRefOf } from "./variations.ts";

describe("a take's name (ADR 0098)", () => {
  it("is what the agent named its working copy, what it varied after the separator", () => {
    expect(takeNameOf(" Editorial · Tone of the copy ")).toEqual({
      name: "Editorial",
      varied: "Tone of the copy",
    });
    expect(takeNameOf("Editorial")).toEqual({ name: "Editorial" });
    // A dot of a name's own is no separator.
    expect(takeNameOf("Café·Bar")).toEqual({ name: "Café·Bar" });
    expect(takeNameOf("Editorial · ")).toEqual({ name: "Editorial" });
  });
});

describe("a thing as /variations names it", () => {
  it("is its document and its node, read back as written", () => {
    const target = { doc: "marketing/notes.page.json", node: "c_1" };
    expect(targetOfRef(variationRefOf(target))).toEqual(target);
    expect(targetOfRef("notes.page.json")).toBeNull();
    expect(targetOfRef("notes.page.json#")).toBeNull();
  });
});
