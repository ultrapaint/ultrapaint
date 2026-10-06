import { describe, expect, it } from "vitest";
import { gridBackground, gridLevels } from "./grid.ts";

const opacities = (zoom: number) => gridLevels(zoom).map((l) => l.opacity);

describe("the grid's lines", () => {
  it("draws every cell only when they are far enough apart on screen", () => {
    // 8px cells: 16px apart at 200%, 8px at 100%, 4px at 50%.
    expect(opacities(2)).toEqual([1, 1, 1]);
    expect(opacities(1)).toEqual([0.5, 1, 1]);
    expect(opacities(0.5)).toEqual([0, 1, 1]);
  });

  it("keeps the coarser lines when zoomed out, never a wash of fine ones", () => {
    const [cells, major, coarse] = opacities(0.05);
    expect(cells).toBe(0);
    expect(major).toBe(0);
    expect(coarse).toBe(1);
  });

  it("fades between levels instead of jumping", () => {
    const steps = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5].map(
      (z) => opacities(z)[0] ?? 0
    );
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] ?? 0);
      expect((steps[i] ?? 0) - (steps[i - 1] ?? 0)).toBeLessThanOrEqual(0.25);
    }
  });
});

describe("the grid's background", () => {
  it("leaves out the sets too faint to see, and follows the view", () => {
    const style = gridBackground({ x: 12.5, y: -3, zoom: 0.5 });
    // The cells are gone at 50%: two sets, each drawn across and down.
    expect(
      String(style.backgroundImage).match(/linear-gradient/g)
    ).toHaveLength(4);
    expect(style.backgroundSize).toBe(
      "32px 32px, 32px 32px, 256px 256px, 256px 256px"
    );
    expect(String(style.backgroundPosition).split(", ")[0]).toBe("12.5px -3px");
  });
});
