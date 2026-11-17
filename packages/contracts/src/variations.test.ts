import { describe, expect, it } from "vitest";
import {
  pageVariantId,
  takeNameOf,
  targetOfRef,
  variationRefOf,
} from "./variations.ts";

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

describe("a page variant's variation (ADR 0098)", () => {
  it("is its name, or one of its own for a name a variation's id may be", () => {
    expect(pageVariantId("bold")).toBe("bold");
    expect(pageVariantId("original")).toBe("variant-original");
    expect(pageVariantId("v2")).toBe("variant-v2");
  });

  it("is a different id for every name", () => {
    const names = ["original", "variant-original", "v2", "variant-v2", "bold"];
    expect(new Set(names.map(pageVariantId)).size).toBe(names.length);
  });
});
