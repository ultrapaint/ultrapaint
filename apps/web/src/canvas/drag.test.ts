import "../testing/fake-browser.ts";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropAt, dropInside } from "./drag.ts";
import { frameOf } from "./editor-frame.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const text = (id: string): DesignNode => ({
  id,
  role: "paragraph",
  text: id,
  type: "text",
});

const column = (id: string, children: DesignNode[]): DesignNode => ({
  children,
  id,
  type: "column",
});

const row = (id: string, children: DesignNode[]): DesignNode => ({
  children,
  id,
  type: "row",
});

const rect = (x: number, y: number, width = 100, height = 20): Rect => ({
  height,
  width,
  x,
  y,
});

/** The frame the drops happen in, at the canvas's origin. */
const frame = { height: 900, width: 1440, x: 0, y: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dropInside", () => {
  const children = [text("a"), text("b")];
  const rects = { a: rect(0, 0), b: rect(0, 40) };
  const own = rect(0, 0, 100, 60);

  it("goes before the first child the pointer is above, in a column", () => {
    const drop = dropInside(
      "p1",
      column("list", children),
      own,
      children,
      rects,
      frame,
      10,
      45
    );
    expect(drop).toMatchObject({
      box: null,
      index: 1,
      line: { height: 0, width: 100, x: 0, y: 40 },
      parent: "list",
    });
  });

  it("goes after the last child below all of them", () => {
    const drop = dropInside(
      "p1",
      column("list", children),
      own,
      children,
      rects,
      frame,
      10,
      500
    );
    expect(drop).toMatchObject({
      index: 2,
      line: { height: 0, width: 100, x: 0, y: 60 },
    });
  });

  it("reads a row along its width", () => {
    const side = { a: rect(0, 0, 50, 20), b: rect(60, 0, 50, 20) };
    const drop = dropInside(
      "p1",
      row("bar", children),
      own,
      children,
      side,
      frame,
      70,
      500
    );
    expect(drop).toMatchObject({
      index: 1,
      line: { height: 20, width: 0, x: 60, y: 0 },
    });
  });

  it("outlines an empty container, with no line", () => {
    const drop = dropInside(
      "p1",
      column("empty", []),
      own,
      [],
      {},
      { ...frame, x: 100, y: 200 },
      0,
      0
    );
    expect(drop).toMatchObject({ box: own, index: 0, line: null });
  });
});

describe("dropAt", () => {
  const measured = (rects: Record<string, Rect>) =>
    vi.spyOn(frameOf("p1"), "measure").mockReturnValue(rects);

  const list = column("list", [text("a"), text("b"), text("c")]);
  const spotOf = (node: DesignNode, exclude: string | null = null) => ({
    exclude,
    frame,
    frameId: "p1",
    node,
    parent: list,
  });

  it("drops beside a node that holds nothing, on the side the pointer is", () => {
    measured({ a: rect(0, 0), b: rect(0, 20), c: rect(0, 40) });
    expect(dropAt(spotOf(text("b")), 10, 22)).toMatchObject({
      index: 1,
      parent: "list",
    });
    expect(dropAt(spotOf(text("b")), 10, 38)).toMatchObject({
      index: 2,
      parent: "list",
    });
  });

  it("drops beside a container near its edges and inside it in its middle", () => {
    const inner = column("inner", [text("x")]);
    const parent = column("outer", [text("a"), inner]);
    measured({ a: rect(0, 0), inner: rect(0, 20, 100, 100), x: rect(0, 30) });
    const spot = { ...spotOf(inner), parent };
    expect(dropAt(spot, 10, 22)).toMatchObject({
      index: 1,
      parent: "outer",
    });
    expect(dropAt(spot, 10, 80)).toMatchObject({
      index: 1,
      parent: "inner",
    });
  });

  it("leaves the dragged node out of the places to drop", () => {
    measured({ a: rect(0, 0), c: rect(0, 40) });
    // "b" is the one dragged: after "c" is index 2 of what is left.
    expect(dropAt(spotOf(text("c"), "b"), 10, 58)).toMatchObject({
      index: 2,
      parent: "list",
    });
  });

  it("offers nothing for a node the preview did not measure, or a lone leaf", () => {
    measured({});
    expect(dropAt(spotOf(text("b")), 10, 22)).toBeNull();
    measured({ a: rect(0, 0) });
    expect(dropAt({ ...spotOf(text("a")), parent: null }, 10, 5)).toBeNull();
  });
});
