import { describe, expect, it } from "vitest";
import { framesNear, framesToShow } from "./mounting.ts";

const screen = { height: 1000, width: 1600 };
const box = (x: number, y: number) => ({ height: 900, width: 1440, x, y });

describe("the frames near the screen", () => {
  it("counts a frame on screen and one within the margin, not one beyond it", () => {
    const boxes = {
      beyond: box(4000, 0),
      near: box(1800, 0),
      on: box(0, 0),
    };
    // At 100%, `near` starts 200px right of the screen; `beyond` 2400px.
    expect([
      ...framesNear(boxes, { x: 0, y: 0, zoom: 1 }, screen, 400),
    ]).toEqual(["near", "on"]);
  });

  it("follows the view: panned and zoomed out, the far frame comes near", () => {
    const boxes = { far: box(4000, 0) };
    expect(framesNear(boxes, { x: 0, y: 0, zoom: 1 }, screen, 400).size).toBe(
      0
    );
    expect(
      framesNear(boxes, { x: -1000, y: 0, zoom: 0.5 }, screen, 400).has("far")
    ).toBe(true);
  });
});

describe("the frames shown while previews load", () => {
  const boxes = {
    far: box(6000, 0),
    left: box(-1600, 0),
    middle: box(0, 0),
    right: box(1600, 0),
  };
  const near = new Set(Object.keys(boxes));
  const view = { x: 80, y: 50, zoom: 0.5 };
  const show = (shown: string[], warm: string[], loadingMax = 2) => [
    ...framesToShow({
      boxes,
      loadingMax,
      near,
      screen,
      shown: new Set(shown),
      view,
      warm: (id) => warm.includes(id),
    }),
  ];

  it("loads a few at a time, the nearest to the middle of the screen first", () => {
    expect(show([], []).sort()).toEqual(["middle", "right"]);
  });

  it("shows at once what is loaded, without it counting as loading", () => {
    expect(show([], ["far", "left"]).sort()).toEqual([
      "far",
      "left",
      "middle",
      "right",
    ]);
  });

  it("waits for what is loading before it loads more", () => {
    expect(show(["middle", "right"], []).sort()).toEqual(["middle", "right"]);
    expect(show(["middle", "right"], ["middle"]).sort()).toEqual([
      "left",
      "middle",
      "right",
    ]);
  });
});
