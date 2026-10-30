import { parseColor, toOklch } from "@ultrapaint/contracts/token-value";
import { describe, expect, it } from "vitest";
import { RAMP_STEPS, rampOf } from "./ramp.ts";

const HEX6 = /^#[0-9a-f]{6}$/;

const lightnessOf = (css: string) => {
  const color = parseColor(css);
  if (!color) {
    throw new Error(`${css} is no colour`);
  }
  return toOklch(color)[0];
};

describe("rampOf", () => {
  it("gives eleven shades, 50 to 950, from light to dark", () => {
    const ramp = rampOf("#2563eb");
    expect(ramp?.map((s) => s.step)).toEqual([...RAMP_STEPS]);
    const lightness = (ramp ?? []).map((s) => lightnessOf(s.value));
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]).toBeLessThan(lightness[i - 1] as number);
    }
  });

  it("keeps the colour given at the step nearest its lightness", () => {
    expect(rampOf("#2563eb")?.find((s) => s.step === 600)?.value).toBe(
      "#2563eb"
    );
    // A light colour lands near the top, a dark one near the bottom.
    expect(rampOf("#dbeafe")?.find((s) => s.value === "#dbeafe")?.step).toBe(
      100
    );
    expect(rampOf("#172554")?.find((s) => s.value === "#172554")?.step).toBe(
      950
    );
  });

  it("writes the shades as the colour is written: hex for hex, oklch() otherwise", () => {
    expect(rampOf("#16a34a")?.every((s) => s.value.startsWith("#"))).toBe(true);
    const ramp = rampOf("oklch(62.3% 0.214 259.815)");
    expect(ramp?.filter((s) => s.value.startsWith("oklch(")).length).toBe(11);
  });

  it("runs the other way in the dark theme", () => {
    const light = rampOf("#dc2626") ?? [];
    const dark = rampOf("#dc2626", "dark") ?? [];
    expect(dark.map((s) => s.value)).toEqual(
      [...light].reverse().map((s) => s.value)
    );
    expect(dark[0]?.step).toBe(50);
  });

  it("stays in sRGB, a grey stays grey, and a value that is no colour gives none", () => {
    for (const shade of rampOf("#00ff00") ?? []) {
      expect(shade.value).toMatch(HEX6);
    }
    const grey = rampOf("#737373") ?? [];
    for (const shade of grey) {
      const [r, g, b] = [1, 3, 5].map((i) =>
        Number.parseInt(shade.value.slice(i, i + 2), 16)
      );
      expect(
        Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0)
      ).toBeLessThanOrEqual(1);
    }
    expect(rampOf("var(--brand)")).toBeNull();
  });
});
