import { describe, expect, it } from "vitest";
import { readFig } from "./fig.ts";
import { isVectorOnly, svgOf } from "./svg.ts";
import { identity, makeFixture, solid } from "./testing/fixture.ts";

/** A page with an icon of shapes, and a card holding a text. */
const file = () => {
  const f = makeFixture();
  const icon = f.add(f.page, {
    name: "icon/target",
    size: { x: 24, y: 24 },
    type: "FRAME",
  });
  f.add(icon, {
    cornerRadius: 4,
    fillPaints: [solid(1, 0, 0)],
    name: "square",
    size: { x: 24, y: 24 },
    transform: identity(),
    type: "ROUNDED_RECTANGLE",
  });
  const inner = f.add(icon, {
    name: "inner",
    opacity: 0.5,
    size: { x: 12, y: 12 },
    transform: identity(6, 6),
    type: "GROUP",
  });
  f.add(inner, {
    fillPaints: [solid(1, 1, 1)],
    name: "dot",
    size: { x: 12, y: 12 },
    transform: identity(),
    type: "ELLIPSE",
  });
  f.add(icon, {
    name: "hidden",
    size: { x: 24, y: 24 },
    transform: identity(),
    type: "TEXT",
    visible: false,
  });
  const card = f.add(f.page, {
    name: "Card",
    size: { x: 200, y: 100 },
    type: "FRAME",
  });
  f.add(card, {
    name: "Label",
    size: { x: 100, y: 16 },
    textData: { characters: "Hi" },
    type: "TEXT",
  });
  return readFig(f.build());
};

describe("vector layers", () => {
  it("are an icon when every visible leaf is a shape, nested groups included", () => {
    const fig = file();
    const [icon, card] = fig.pages[0]?.frames ?? [];
    if (!(icon && card)) {
      throw new Error("no frames");
    }
    expect(isVectorOnly(fig, icon)).toBe(true);
    expect(isVectorOnly(fig, card)).toBe(false);
  });

  it("draw as one SVG at the icon's size, with each shape's paint, place and opacity", () => {
    const fig = file();
    const icon = fig.pages[0]?.frames[0];
    if (!icon) {
      throw new Error("no icon");
    }
    expect(svgOf(fig, icon)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<rect width="24" height="24" rx="4" fill="#ff0000"/>' +
        '<g transform="matrix(1 0 0 1 6 6)" opacity="0.5">' +
        '<ellipse cx="6" cy="6" rx="6" ry="6" fill="#ffffff"/>' +
        "</g></svg>"
    );
    expect(svgOf(fig, { ...icon, size: { x: 0, y: 24 } })).toBeNull();
  });
});
