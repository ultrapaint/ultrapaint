import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { childrenOf } from "@ultrapaint/design-document/tree";
import type { FigGuid } from "openfig-core";
import { describe, expect, it } from "vitest";
import { candidatesFor } from "./candidates.ts";
import { convertComponent, convertFrame } from "./convert.ts";
import { readFig } from "./fig.ts";
import { outlineOf } from "./outline.ts";
import { makeTokenMatcher } from "./paint.ts";
import { identity, makeFixture, PNG_BYTES, solid } from "./testing/fixture.ts";
import { weightOf } from "./text.ts";

/**
 * A file with one page holding a login frame, and a Button component set (Size=Large|Small)
 * with a Label text property, used twice on the frame, once with the label overridden.
 */
const loginFile = () => {
  const f = makeFixture();
  const labelDef: FigGuid = { localID: 5, sessionID: 9 };
  const set = f.add(f.internal, {
    componentPropDefs: [
      {
        id: labelDef,
        initialValue: { textValue: { characters: "Button" } },
        name: "Label#9:5",
        type: "TEXT",
      },
    ],
    isStateGroup: true,
    name: "Button",
    size: { x: 300, y: 120 },
    type: "FRAME",
  });
  const symbols: Record<string, FigGuid> = {};
  for (const [index, size] of ["Large", "Small"].entries()) {
    const symbol = f.add(set, {
      cornerRadius: 6,
      fillPaints: [solid(0.2, 0.4, 1)],
      name: `Size=${size}`,
      size: { x: 120, y: size === "Large" ? 48 : 32 },
      stackCounterAlignItems: "CENTER",
      stackHorizontalPadding: 16,
      stackMode: "HORIZONTAL",
      stackPrimaryAlignItems: "CENTER",
      stackVerticalPadding: 8,
      transform: identity(0, index * 60),
      type: "SYMBOL",
    });
    f.add(symbol, {
      componentPropRefs: [
        { componentPropNodeField: "TEXT_DATA", defID: labelDef },
      ],
      fillPaints: [solid(1, 1, 1)],
      fontName: {
        family: "Inter",
        postscript: "Inter-SemiBold",
        style: "Semi Bold",
      },
      fontSize: 16,
      name: "Label",
      overrideKey: { localID: 100 + index, sessionID: 9 },
      size: { x: 88, y: 24 },
      textAutoResize: "WIDTH_AND_HEIGHT",
      textData: { characters: "Button" },
      type: "TEXT",
    });
    symbols[size] = symbol;
  }

  const frame = f.add(f.page, {
    fillPaints: [solid(1, 1, 1)],
    name: "Login",
    size: { x: 400, y: 600 },
    stackCounterAlignItems: "CENTER",
    stackCounterSizing: "FIXED",
    stackHorizontalPadding: 24,
    stackMode: "VERTICAL",
    stackPrimarySizing: "FIXED",
    stackSpacing: 16,
    stackVerticalPadding: 32,
    type: "FRAME",
  });
  f.add(frame, {
    fillPaints: [solid(0.1, 0.1, 0.1)],
    fontName: { family: "Inter", postscript: "Inter-Bold", style: "Bold" },
    fontSize: 32,
    lineHeight: { units: "PERCENT", value: 120 },
    name: "Title",
    size: { x: 300, y: 40 },
    textAlignHorizontal: "CENTER",
    textAutoResize: "WIDTH_AND_HEIGHT",
    textData: { characters: "Welcome back" },
    type: "TEXT",
  });
  f.add(frame, {
    fontName: {
      family: "Inter",
      postscript: "Inter-Regular",
      style: "Regular",
    },
    fontSize: 14,
    name: "Intro",
    size: { x: 352, y: 40 },
    textAutoResize: "HEIGHT",
    textData: { characters: "Sign in to continue to your dashboard." },
    type: "TEXT",
  });
  f.add(frame, {
    fillPaints: [
      {
        image: { hash: new Uint8Array(20).fill(0xab) },
        imageScaleMode: "FILL",
        type: "IMAGE",
        visible: true,
      },
    ],
    name: "Hero",
    size: { x: 352, y: 160 },
    type: "RECTANGLE",
  });
  f.add(frame, {
    componentPropAssignments: [
      { defID: labelDef, value: { textValue: { characters: "Sign in" } } },
    ],
    name: "Button",
    size: { x: 352, y: 48 },
    stackChildAlignSelf: "STRETCH",
    symbolData: { symbolID: symbols.Large as FigGuid },
    type: "INSTANCE",
  });
  f.add(frame, {
    name: "Button",
    size: { x: 120, y: 32 },
    symbolData: { symbolID: symbols.Small as FigGuid },
    type: "INSTANCE",
  });
  f.addImage("ab".repeat(20), PNG_BYTES);
  return readFig(f.build());
};

const options = () => ({ mapping: {}, next: makeIdGenerator(["root"]) });
const SVG_SRC_RE = /^assets\/figma-[0-9a-f]{8}\.svg$/;

describe("reading a .fig file", () => {
  it("lists the pages, the frames and the components with their variants and uses", () => {
    const file = loginFile();
    expect(file.pages.map((p) => p.name)).toEqual(["Page 1"]);
    expect(file.pages[0]?.frames.map((f) => f.name)).toEqual(["Login"]);
    const [button] = file.components;
    expect(button?.key).toBe("Button");
    expect(button?.variants).toEqual({ Size: ["Large", "Small"] });
    expect(button?.props).toEqual([{ id: "9:5", name: "Label", type: "text" }]);
    expect(button?.uses).toBe(2);
    expect(button?.page).toBe("Internal Only Canvas");
  });
});

describe("converting a frame", () => {
  it("turns auto-layout into a column page, with text, image and expanded instances", () => {
    const file = loginFile();
    const frame = file.pages[0]?.frames[0];
    if (!frame) {
      throw new Error("no frame");
    }
    const { images, root, unmapped, warnings } = convertFrame(
      file,
      frame,
      options()
    );
    expect(root).toMatchObject({
      crossAlign: "center",
      fill: "#ffffff",
      gap: 16,
      name: "Login",
      padding: { bottom: 32, left: 24, right: 24, top: 32 },
      type: "page",
    });
    if (root.type !== "page") {
      throw new Error("not a page");
    }
    const [title, intro, hero, large, small] = root.children;
    expect(title).toMatchObject({
      align: "center",
      color: "#1a1a1a",
      font: "Inter",
      level: 2,
      lineHeight: "120%",
      role: "heading",
      size: 32,
      text: "Welcome back",
      type: "text",
      weight: 700,
    });
    expect(intro).toMatchObject({ role: "paragraph", width: 352 });
    expect(hero).toMatchObject({
      fit: "cover",
      height: 160,
      src: "assets/figma-abababababab.png",
      type: "image",
      width: 352,
    });
    expect(images.map((i) => i.src)).toEqual(["assets/figma-abababababab.png"]);
    // An unmapped instance is the component's own layers, with the instance's text in them.
    expect(large).toMatchObject({
      align: "center",
      crossAlign: "center",
      fill: "#3366ff",
      name: "Button",
      padding: { bottom: 8, left: 16, right: 16, top: 8 },
      radius: 6,
      type: "row",
      width: "fill",
    });
    if (large?.type !== "row") {
      throw new Error("not a row");
    }
    expect(large.children[0]).toMatchObject({ text: "Sign in", type: "text" });
    if (small?.type !== "row") {
      throw new Error("not a row");
    }
    expect(small.children[0]).toMatchObject({ text: "Button", weight: 600 });
    expect(unmapped).toEqual({ Button: 2 });
    expect(warnings).toEqual([]);
  });

  it("replaces instances with the repository's component as the mapping says", () => {
    const file = loginFile();
    const frame = file.pages[0]?.frames[0];
    if (!frame) {
      throw new Error("no frame");
    }
    const { root, unmapped } = convertFrame(file, frame, {
      ...options(),
      mapping: {
        Button: {
          component: "Button",
          kind: "component",
          propMap: {
            Label: { text: true },
            Size: { prop: "size", values: { Large: "lg", Small: "sm" } },
          },
          props: { variant: "primary" },
        },
      },
    });
    if (root.type !== "page") {
      throw new Error("not a page");
    }
    expect(root.children[3]).toMatchObject({
      component: "Button",
      from: SYSTEM_FROM,
      props: { size: "lg", variant: "primary" },
      text: "Sign in",
      type: "instance",
      width: "fill",
    });
    expect(root.children[4]).toMatchObject({
      props: { size: "sm", variant: "primary" },
      text: "Button",
    });
    expect(unmapped).toEqual({});
  });

  it("leaves out skipped components, and takes the text from the instance's layers", () => {
    const file = loginFile();
    const frame = file.pages[0]?.frames[0];
    if (!frame) {
      throw new Error("no frame");
    }
    const skipped = convertFrame(file, frame, {
      ...options(),
      mapping: { Button: { kind: "skip" } },
    });
    if (skipped.root.type !== "page") {
      throw new Error("not a page");
    }
    expect(skipped.root.children).toHaveLength(3);
    const shown = convertFrame(file, frame, {
      ...options(),
      mapping: {
        Button: {
          component: "Button",
          kind: "component",
          text: "children",
        },
      },
    });
    if (shown.root.type !== "page") {
      throw new Error("not a page");
    }
    expect(shown.root.children[3]).toMatchObject({ text: "Sign in" });
  });

  it("writes colours the design system has a token for as the first that holds it, in any space", () => {
    const file = loginFile();
    const frame = file.pages[0]?.frames[0];
    if (!frame) {
      throw new Error("no frame");
    }
    const tokens = makeTokenMatcher({
      colors: [
        {
          name: "Semantic",
          tokens: [
            { name: "color-background", value: "oklch(1 0 0)" },
            { name: "color-primary", value: "rgb(51, 102, 255)" },
          ],
        },
        { name: "Palette", tokens: [{ name: "color-white", value: "#FFF" }] },
      ],
      radius: [],
      shadows: [],
      spacing: { base: "0.25rem" },
      typography: { fonts: [], sizes: [], styles: [], weights: [] },
      version: 1,
    });
    const { root } = convertFrame(file, frame, { ...options(), tokens });
    expect(root.fill).toBe("$color-background");
    if (root.type !== "page") {
      throw new Error("not a page");
    }
    expect(root.children[3]?.fill).toBe("$color-primary");
  });

  it("shows a component's definition as a page", () => {
    const file = loginFile();
    const [button] = file.components;
    if (!button) {
      throw new Error("no component");
    }
    const { root } = convertComponent(file, button, options());
    if (root.type !== "page") {
      throw new Error("not a page");
    }
    expect(root.children[0]).toMatchObject({
      fill: "#3366ff",
      type: "row",
      width: "fill",
    });
  });
});

describe("the outline", () => {
  it("names the layers, the text and the instances with their variant", () => {
    const file = loginFile();
    const frame = file.pages[0]?.frames[0];
    if (!frame) {
      throw new Error("no frame");
    }
    const outline = outlineOf(file, frame);
    expect(outline.split("\n")).toEqual([
      'column "Login" 400×600 gap=16 padding=24 fill=#ffffff',
      '  text "Welcome back" 32px Inter Bold color=#1a1a1a',
      '  text "Sign in to continue to your dashboard." 14px Inter Regular',
      '  rectangle "Hero" 352×160',
      '  instance "Button" [Size=Large] 352×48 (unmapped)',
      '  instance "Button" [Size=Small] 120×32 (unmapped)',
    ]);
  });
});

describe("shapes and free layout", () => {
  it("draws an icon as one SVG, a full-size rectangle as the frame's background, and stacks free layers in reading order", () => {
    const f = makeFixture();
    const frame = f.add(f.page, {
      name: "Card",
      size: { x: 200, y: 100 },
      type: "FRAME",
    });
    f.add(frame, {
      cornerRadius: 12,
      fillPaints: [solid(0.5, 0.5, 0.5)],
      name: "Background",
      size: { x: 200, y: 100 },
      transform: identity(),
      type: "ROUNDED_RECTANGLE",
    });
    f.add(frame, {
      fontSize: 12,
      name: "Below",
      size: { x: 100, y: 16 },
      textData: { characters: "second" },
      transform: identity(10, 60),
      type: "TEXT",
    });
    const icon = f.add(frame, {
      name: "icon/check",
      size: { x: 16, y: 16 },
      transform: identity(10, 10),
      type: "FRAME",
    });
    f.add(icon, {
      fillPaints: [solid(0, 0, 0)],
      name: "dot",
      size: { x: 16, y: 16 },
      transform: identity(),
      type: "ELLIPSE",
    });
    const file = readFig(f.build());
    const card = file.pages[0]?.frames[0];
    if (!card) {
      throw new Error("no frame");
    }
    const { images, root, warnings } = convertFrame(file, card, options());
    expect(root).toMatchObject({ fill: "#808080", type: "page" });
    if (root.type !== "page") {
      throw new Error("not a page");
    }
    const [group] = root.children;
    if (group?.type !== "group") {
      throw new Error("not a group");
    }
    expect(group).toMatchObject({ fill: "#808080", radius: 12, width: "fill" });
    expect(group.children.map((c) => c.type)).toEqual(["image", "text"]);
    expect(group.children[0]).toMatchObject({ height: 16, width: 16 });
    const [svg] = images;
    expect(svg?.src).toMatch(SVG_SRC_RE);
    expect(new TextDecoder().decode(svg?.bytes)).toContain("<ellipse");
    expect(warnings).toEqual([
      '"Card" places its layers freely; they were stacked in reading order',
    ]);
  });
});

describe("reading order", () => {
  it("puts free layers in rows, then reads each row left to right, whatever order they come in", () => {
    const f = makeFixture();
    const frame = f.add(f.page, {
      name: "Loose",
      size: { x: 200, y: 100 },
      type: "FRAME",
    });
    // A and B share a row, B and C are a few pixels apart too, but C is below A's row.
    for (const [name, x, y] of [
      ["C", 0, 6],
      ["B", 10, 3],
      ["A", 20, 0],
      ["D", 5, 40],
    ] as const) {
      f.add(frame, {
        fontSize: 12,
        name,
        size: { x: 8, y: 2 },
        textData: { characters: name },
        transform: identity(x, y),
        type: "TEXT",
      });
    }
    const file = readFig(f.build());
    const loose = file.pages[0]?.frames[0];
    if (!loose) {
      throw new Error("no frame");
    }
    const { root } = convertFrame(file, loose, options());
    const texts: string[] = [];
    const visit = (node: DesignNode) => {
      if (node.type === "text") {
        texts.push(node.text);
      }
      for (const child of childrenOf(node)) {
        visit(child);
      }
    };
    visit(root);
    expect(texts).toEqual(["B", "A", "C", "D"]);
  });
});

describe("helpers", () => {
  it("reads weights from font styles", () => {
    expect(weightOf("Semi Bold Italic")).toBe(600);
    expect(weightOf("Regular")).toBeUndefined();
    expect(weightOf("ExtraBold")).toBe(800);
  });

  it("suggests the repository's components by name", () => {
    const components = [
      { importFrom: "@acme/ui/button", name: "Button" },
      { importFrom: "@acme/ui/badge", name: "Badge" },
      { importFrom: "@acme/ui/dialog", name: "Dialog" },
    ];
    expect(candidatesFor("Button/Primary", components)[0]?.name).toBe("Button");
    expect(candidatesFor("Buttons", components)[0]?.name).toBe("Button");
    expect(candidatesFor("icon/arrow-left", components)).toEqual([]);
  });
});
