import "../testing/fake-browser.ts";
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { placeFrame, resizeFrom } from "./canvas.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const box = { height: 100, width: 200, x: 10, y: 20 };

describe("resizeFrom", () => {
  it("keeps the opposite corner where it was", () => {
    expect(resizeFrom(box, "se", 30, 40, 8, false)).toEqual({
      height: 140,
      width: 230,
      x: 10,
      y: 20,
    });
    // Dragging the top left in by (30, 40): the bottom right stays at (210, 120).
    expect(resizeFrom(box, "nw", 30, 40, 8, false)).toEqual({
      height: 60,
      width: 170,
      x: 40,
      y: 60,
    });
  });

  it("goes no smaller than the least size", () => {
    expect(resizeFrom(box, "ne", -500, 500, 8, false)).toEqual({
      height: 8,
      width: 8,
      x: 10,
      y: 112,
    });
  });

  it("keeps the ratio by the side moved further", () => {
    // Twice as wide: twice as tall.
    expect(resizeFrom(box, "se", 200, 10, 8, true)).toEqual({
      height: 200,
      width: 400,
      x: 10,
      y: 20,
    });
  });
});

describe("placeFrame", () => {
  const frame = (x: number, y: number): FrameLayout => ({
    height: 900,
    preset: "desktop",
    width: 1440,
    x,
    y,
  });
  const plain = { ctrlKey: false, metaKey: false, shiftKey: false };

  beforeEach(() => {
    useEditor.setState({
      frames: { a: frame(0, 0), b: frame(1563, 0) },
      view: { x: 0, y: 0, zoom: 1 },
    });
  });

  it("lands on the grid when it snaps", () => {
    const placed = placeFrame(frame(1003, 7), "b", true, plain);
    expect(placed.x % 8).toBe(0);
    expect(placed.y % 8).toBe(0);
  });

  it("snaps to the edges of the frames near it", () => {
    // Four pixels from where its left edge meets the right edge of "a".
    expect(placeFrame(frame(1444, 3), "b", false, plain)).toMatchObject({
      x: 1440,
    });
  });

  it("goes exactly where it is put with Shift or ⌘/Ctrl held", () => {
    expect(
      placeFrame(frame(1444, 3), "b", false, { ...plain, shiftKey: true })
    ).toMatchObject({ x: 1444, y: 3 });
    expect(
      placeFrame(frame(1444, 3), "b", false, { ...plain, metaKey: true })
    ).toMatchObject({ x: 1444, y: 3 });
  });
});
