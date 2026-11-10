import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { OPACITY_OPTIONS, opacityOf } from "./inspector-appearance.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("an opacity as a field gives it", () => {
  it("is the fraction typed, from 0 to 1", () => {
    expect(opacityOf(0.5)).toBe(0.5);
    expect(opacityOf(0)).toBe(0);
    expect(opacityOf(1)).toBe(1);
  });

  it("reads a number above 1 as a percentage", () => {
    expect(opacityOf(50)).toBe(0.5);
    expect(opacityOf(100)).toBe(1);
    expect(opacityOf(250)).toBe(1);
  });

  it("is never below nothing", () => {
    expect(opacityOf(-0.2)).toBe(0);
  });

  it("is none for a field cleared, or for what is no number", () => {
    expect(opacityOf(null)).toBeNull();
    expect(opacityOf("$color-brand")).toBeNull();
    expect(opacityOf("")).toBeNull();
  });

  it("takes every option the field offers as it is", () => {
    expect(OPACITY_OPTIONS.map((o) => opacityOf(o.value))).toEqual([
      1, 0.9, 0.75, 0.5, 0.25, 0.1, 0,
    ]);
  });
});
