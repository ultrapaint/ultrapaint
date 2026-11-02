import "../testing/fake-browser.ts";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it, vi } from "vitest";
import { pageRequest } from "./page-request.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** A page whose gap is 2 below `md` (768) and 4 from it. */
const page = {
  at: { md: { gap: 4 } },
  children: [],
  gap: 2,
  id: "page",
  type: "page",
} as unknown as DesignNode;

/** A node on the canvas, 400 wide, whose gap is 8 from `sm` (640). */
const node = {
  at: { sm: { gap: 8 } },
  children: [],
  gap: 1,
  height: 100,
  id: "card",
  type: "column",
  width: 400,
} as unknown as DesignNode;

const designSystem = {
  colors: [],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
} as DesignSystem;

const defaults = { font: "Inter" };

const drawn = (over: Partial<Parameters<typeof pageRequest>[0]>) =>
  pageRequest({
    defaults,
    designSystem,
    mode: "page",
    root: page,
    width: 1200,
    ...over,
  });

const gapOf = (root: DesignNode | null) =>
  (root as { gap?: unknown } | null)?.gap;

describe("pageRequest", () => {
  it("draws a page with the canvas's defaults and the design system", () => {
    const request = drawn({});
    expect(request).toMatchObject({ defaults, designSystem });
    expect(request.mode).toBe("page");
    expect(request.message).toBeUndefined();
  });

  it.each([
    { expected: undefined, over: {} },
    {
      expected: "This page cannot be read: line 3 is not JSON",
      over: { problem: "line 3 is not JSON", root: null },
    },
    {
      expected: "No page serves /orders",
      over: { absent: "No page serves /orders", root: null },
    },
  ])("says $expected for what cannot be drawn", ({ expected, over }) => {
    expect(drawn(over).message).toBe(expected);
  });

  it.each([
    { gap: 2, width: 500 },
    { gap: 2, width: 767 },
    { gap: 4, width: 768 },
    { gap: 4, width: 1440 },
  ])(
    "draws a page $width wide at its breakpoint's values",
    ({ gap, width }) => {
      expect(gapOf(drawn({ width }).root)).toBe(gap);
    }
  );

  it("gives the same tree at another width of the same breakpoint, so nothing draws again", () => {
    expect(drawn({ width: 800 }).root).toBe(drawn({ width: 1000 }).root);
    expect(drawn({ width: 500 }).root).not.toBe(drawn({ width: 900 }).root);
  });

  it("draws a node at its own width when it is given none", () => {
    const request = drawn({ mode: "fit", root: node, width: undefined });
    expect(request.mode).toBe("fit");
    expect(request.root).toMatchObject({ gap: 1, width: 400 });
  });

  it("draws a node held at the size it is dragged to, at that size's breakpoint", () => {
    const held = { height: 120, width: 700, x: 5, y: 6 };
    const request = drawn({ held, mode: "fit", root: node, width: undefined });
    expect(request.root).toMatchObject({ gap: 8, height: 120, width: 700 });
    // Where it is held is the canvas's, not the node's.
    expect(request.root).not.toHaveProperty("x");
    // Held at the same size, it is the same tree.
    expect(
      drawn({ held: { ...held }, mode: "fit", root: node, width: undefined })
        .root
    ).toBe(request.root);
  });

  it("draws a node held only where it was let go as its document has it", () => {
    const request = drawn({
      held: { x: 5, y: 6 },
      mode: "fit",
      root: node,
      width: undefined,
    });
    expect(request.root).toBe(
      drawn({ mode: "fit", root: node, width: undefined }).root
    );
    expect(request.root).toMatchObject({ gap: 1, width: 400 });
  });
});
