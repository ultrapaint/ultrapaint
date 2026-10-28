import type { TextStyle } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  ALIGN,
  sharedField,
  TEXT_STYLE,
  TOKEN_FIELDS,
  unsetValueOf,
} from "./node-fields.ts";
import { MIXED } from "./shared-value.ts";

const text = (extra: Partial<DesignNode> = {}): DesignNode =>
  ({
    id: "t",
    role: "paragraph",
    text: "Hi",
    type: "text",
    ...extra,
  }) as DesignNode;
const row = (extra: Partial<DesignNode> = {}): DesignNode =>
  ({ children: [], id: "r", type: "row", ...extra }) as DesignNode;
const group = (extra: Partial<DesignNode> = {}): DesignNode =>
  ({ children: [], id: "g", type: "group", ...extra }) as DesignNode;
const image = (extra: Partial<DesignNode> = {}): DesignNode =>
  ({ id: "i", src: "a.png", type: "image", ...extra }) as DesignNode;

describe("a text's align", () => {
  it.each([
    ["none set", [text(), text()], "start"],
    ["unset beside start", [text(), text({ align: "start" })], "start"],
    [
      "start beside centre",
      [text({ align: "start" }), text({ align: "center" })],
      MIXED,
    ],
    [
      "centre",
      [text({ align: "center" }), text({ align: "center" })],
      "center",
    ],
  ] as const)("reads %s as one value", (_, nodes, shared) => {
    expect(sharedField(ALIGN, nodes)).toBe(shared);
  });

  it("writes start as unset, and the others as they are", () => {
    expect(ALIGN.write("start")).toEqual({ align: null });
    expect(ALIGN.write("center")).toEqual({ align: "center" });
    expect(ALIGN.write("end")).toEqual({ align: "end" });
    expect(ALIGN.label("center")).toBe("Align the text");
  });

  it("is start where a text has none, and nothing of a stack's align", () => {
    expect(unsetValueOf(text(), "align")).toBe("start");
    expect(unsetValueOf(row(), "align")).toBeUndefined();
    expect(unsetValueOf(text(), "color")).toBeUndefined();
  });
});

describe("a text's style", () => {
  const style: TextStyle = {
    name: "body",
    role: "paragraph",
    size: 16,
    weight: 400,
  };

  it("reads by name, a text in none beside one in a style as mixed", () => {
    expect(sharedField(TEXT_STYLE, [text({ textStyle: "body" })])).toBe("body");
    expect(sharedField(TEXT_STYLE, [text(), text()])).toBeUndefined();
    expect(sharedField(TEXT_STYLE, [text(), text({ textStyle: "body" })])).toBe(
      MIXED
    );
  });

  it("sets the text in the style, its own settings taken off", () => {
    expect(TEXT_STYLE.write(style)).toMatchObject({
      size: null,
      textStyle: "body",
      weight: null,
    });
    expect(TEXT_STYLE.label(style)).toBe("Set the text in body");
  });
});

describe("the fields picked from tokens", () => {
  it.each([
    ["color", text({ color: "$color-primary" }), text(), "colour", "color"],
    ["fill", row({ fill: "$color-card" }), image(), "fill", "color"],
    ["tint", image({ tint: "$color-muted" }), image(), "tint", "color"],
    ["radius", image({ radius: "$radius-lg" }), row(), "radius", "radius"],
    ["shadow", group({ shadow: "$shadow-md" }), row(), "shadow", "shadow"],
    ["gap", row({ gap: 16 }), row(), "gap", "spacing"],
  ] as const)("%s", (name, set, other, noun, options) => {
    const field = TOKEN_FIELDS[name];
    const value = field.read(set);
    expect(value).toBeDefined();
    expect(sharedField(field, [set, set])).toEqual(value);
    expect(sharedField(field, [other, other])).toBeUndefined();
    expect(sharedField(field, [set, other])).toBe(MIXED);
    expect(field.write("$x")).toEqual({ [name]: "$x" });
    expect(field.write(null)).toEqual({ [name]: null });
    expect(field.label("$x")).toBe(`Change the ${noun}`);
    expect(field.options).toBe(options);
  });

  it("reads nothing of a node without the field", () => {
    expect(
      TOKEN_FIELDS.color.read(row({ fill: "$color-card" }))
    ).toBeUndefined();
    expect(TOKEN_FIELDS.tint.read(text())).toBeUndefined();
    // A group has no gap.
    expect(TOKEN_FIELDS.gap.read(group())).toBeUndefined();
  });
});
