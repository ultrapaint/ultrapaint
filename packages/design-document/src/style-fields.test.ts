import { type DesignNode, NODE_FIELDS } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { styleFieldsOf, styleFor, styleOf } from "./style-fields.ts";

/** What every node's box sets that is not its look: identity, size, margin and place. */
const box = {
  height: "hug",
  hidden: true,
  id: "n",
  link: "/next",
  locked: true,
  margin: 8,
  maxHeight: 400,
  maxWidth: 600,
  minHeight: 10,
  minWidth: 20,
  name: "Card",
  order: 2,
  slot: "footer",
  width: 320,
  x: 10,
  y: 20,
} as const;

/** What every node's box sets that is its look. */
const look = {
  backdropBlur: "$blur-md",
  border: { color: "$color-border", width: 1 },
  fill: "$color-surface",
  opacity: 0.8,
  padding: 16,
  radius: "$radius-md",
  shadow: "$shadow-md",
} as const;

const row: DesignNode = {
  ...box,
  ...look,
  align: "between",
  at: { md: { fill: "$color-muted" } },
  children: [{ id: "c", role: "paragraph", text: "Hi", type: "text" }],
  crossAlign: "center",
  gap: 12,
  type: "row",
  wrap: true,
};

const text: DesignNode = {
  ...box,
  ...look,
  align: "center",
  color: "$color-text",
  font: "$font-sans",
  level: 2,
  lineHeight: "$leading-tight",
  role: "heading",
  size: "$text-xl",
  text: "Welcome",
  textStyle: "Heading xl",
  tracking: "-0.01em",
  type: "text",
  weight: 600,
};

const image: DesignNode = {
  ...box,
  ...look,
  alt: "A hill",
  fit: "contain",
  src: "assets/hill.png",
  tint: "$color-muted",
  type: "image",
};

const instance: DesignNode = {
  ...box,
  ...look,
  component: "Button",
  from: "#app",
  overrides: { label: { text: "Go" } },
  props: { size: "lg" },
  text: "Go",
  type: "instance",
};

const keys = (node: DesignNode) => Object.keys(styleOf(node).fields).sort();

describe("the style of a node", () => {
  it("is its box's look, for every type", () => {
    const boxLook = Object.keys(look).sort();
    expect(keys(instance)).toEqual(boxLook);
    expect(keys({ ...look, children: [], id: "g", type: "group" })).toEqual(
      boxLook
    );
  });

  it("of a row or a column, its spacing and alignment too", () => {
    expect(keys(row)).toEqual(
      [...Object.keys(look), "align", "crossAlign", "gap", "wrap"].sort()
    );
    expect(styleOf({ ...row, type: "column" }).fields).toEqual(
      styleOf(row).fields
    );
  });

  it("of a text, its text style and its own settings over it too", () => {
    expect(styleOf(text).fields).toEqual({
      ...look,
      align: "center",
      color: "$color-text",
      font: "$font-sans",
      lineHeight: "$leading-tight",
      size: "$text-xl",
      textStyle: "Heading xl",
      tracking: "-0.01em",
      weight: 600,
    });
  });

  it("of an image, its fit and tint too", () => {
    expect(keys(image)).toEqual([...Object.keys(look), "fit", "tint"].sort());
  });

  it("never holds what it says, its size, margin, place, identity, direction or type", () => {
    const never = [
      ...Object.keys(box),
      "alt",
      "at",
      "children",
      "component",
      "direction",
      "from",
      "level",
      "overrides",
      "props",
      "role",
      "src",
      "text",
      "type",
    ];
    for (const node of [row, text, image, instance]) {
      for (const key of never) {
        expect(styleOf(node).fields, `${node.type}.${key}`).not.toHaveProperty(
          key
        );
      }
    }
  });

  it("holds only the fields it sets", () => {
    expect(
      styleOf({
        fill: "red",
        id: "t",
        role: "paragraph",
        text: "",
        type: "text",
      }).fields
    ).toEqual({ fill: "red" });
  });

  it("names only fields its type has", () => {
    for (const type of Object.keys(NODE_FIELDS) as DesignNode["type"][]) {
      for (const key of styleFieldsOf(type)) {
        expect(NODE_FIELDS[type].own.has(key), `${type}.${key}`).toBe(true);
      }
    }
  });
});

describe("the style for a type", () => {
  it("sets what was copied and clears the rest of the type's style", () => {
    const plain = styleOf({
      children: [],
      fill: "$color-accent",
      gap: 4,
      id: "r",
      type: "row",
    });
    expect(styleFor(plain, "column")).toEqual({
      align: null,
      backdropBlur: null,
      border: null,
      crossAlign: null,
      fill: "$color-accent",
      gap: 4,
      opacity: null,
      padding: null,
      radius: null,
      shadow: null,
      wrap: null,
    });
  });

  it("onto a text, gives it the same text style and own settings, and leaves its role and level alone", () => {
    const set = styleFor(styleOf(text), "text");
    expect(set).toEqual(styleOf(text).fields);
    expect(set).not.toHaveProperty("role");
    expect(set).not.toHaveProperty("level");
  });

  it("from a text onto a row, keeps only the box's look: a text's align is not a row's", () => {
    expect(styleFor(styleOf(text), "row")).toEqual(look);
  });

  it("from a row onto a text, keeps only the box's look", () => {
    expect(styleFor(styleOf(row), "text")).toEqual(look);
  });

  it("from an image onto an instance, the box's look", () => {
    expect(styleFor(styleOf(image), "instance")).toEqual(look);
  });
});
