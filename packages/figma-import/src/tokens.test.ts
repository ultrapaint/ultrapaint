import { describe, expect, it } from "vitest";
import { readFig } from "./fig.ts";
import { makeFixture, solid } from "./testing/fixture.ts";
import { readFigmaTokens, tokenNameOf } from "./tokens.ts";

const guid = (localID: number) => ({ localID, sessionID: 9 });
const mode = (localID: number, name: string) => ({
  id: guid(localID),
  name,
  sortPosition: String(localID),
});
const color = (r: number, g: number, b: number, a = 1) => ({
  dataType: "COLOR",
  resolvedDataType: "COLOR",
  value: { colorValue: { a, b, g, r } },
});
const float = (n: number) => ({
  dataType: "FLOAT",
  resolvedDataType: "FLOAT",
  value: { floatValue: n },
});
const alias = (localID: number) => ({
  dataType: "ALIAS",
  resolvedDataType: "COLOR",
  value: { alias: { guid: guid(localID) } },
});

/** A file with a primitives collection, a semantic one with light and dark, and two styles. */
const file = () => {
  const fixture = makeFixture();
  const primitives = fixture.add(fixture.internal, {
    guid: guid(1),
    name: "Primitives",
    type: "VARIABLE_SET",
    variableSetModes: [mode(2, "Value")],
  } as never);
  fixture.add(fixture.internal, {
    guid: guid(10),
    name: "Blue/500",
    type: "VARIABLE",
    variableDataValues: {
      entries: [{ modeID: guid(2), variableData: color(0.231, 0.51, 0.965) }],
    },
    variableResolvedType: "COLOR",
    variableSetID: { guid: primitives },
  } as never);
  fixture.add(fixture.internal, {
    guid: guid(11),
    name: "Radius/Card",
    type: "VARIABLE",
    variableDataValues: {
      entries: [{ modeID: guid(2), variableData: float(12) }],
    },
    variableResolvedType: "FLOAT",
    variableSetID: { guid: primitives },
  } as never);
  fixture.add(fixture.internal, {
    guid: guid(12),
    name: "Opacity/Disabled",
    type: "VARIABLE",
    variableDataValues: {
      entries: [{ modeID: guid(2), variableData: float(0.5) }],
    },
    variableResolvedType: "FLOAT",
    variableSetID: { guid: primitives },
  } as never);
  const semantic = fixture.add(fixture.internal, {
    guid: guid(3),
    name: "Semantic",
    type: "VARIABLE_SET",
    variableSetModes: [mode(4, "Light"), mode(5, "Dark")],
  } as never);
  fixture.add(fixture.internal, {
    guid: guid(20),
    name: "Primary",
    type: "VARIABLE",
    variableDataValues: {
      entries: [
        { modeID: guid(4), variableData: alias(10) },
        { modeID: guid(5), variableData: color(1, 1, 1) },
      ],
    },
    variableResolvedType: "COLOR",
    variableSetID: { guid: semantic },
  } as never);
  fixture.add(fixture.internal, {
    fillPaints: [solid(1, 0, 0)],
    name: "Brand/Accent",
    styleType: "FILL",
    type: "RECTANGLE",
  } as never);
  fixture.add(fixture.internal, {
    effects: [
      {
        color: { a: 0.1, b: 0, g: 0, r: 0 },
        offset: { x: 0, y: 4 },
        radius: 8,
        spread: 0,
        type: "DROP_SHADOW",
        visible: true,
      },
    ],
    name: "Shadow/Card",
    styleType: "EFFECT",
    type: "RECTANGLE",
  } as never);
  return readFig(fixture.build());
};

describe("the tokens of a Figma file", () => {
  it("names them as the code does", () => {
    expect(tokenNameOf("color", "Colors/Primary/500")).toBe(
      "color-primary-500"
    );
    expect(tokenNameOf("radius", "Primitives/Radius/Card")).toBe("radius-card");
    expect(tokenNameOf("fontSize", "Typography/Font size/Body LG")).toBe(
      "text-body-lg"
    );
    expect(tokenNameOf("color", "Colors")).toBeNull();
    // What Figma calls a collection nobody named, and a word said twice, are left out.
    expect(tokenNameOf("color", "Collection 1/Brand/50")).toBe(
      "color-brand-50"
    );
    expect(tokenNameOf("color", "Color/Danger/Danger")).toBe("color-danger");
    expect(tokenNameOf("spacing", "Spacing/Grid/2/2")).toBe("spacing-grid-2-2");
  });

  it("reads variables mode by mode, follows aliases, and takes colour and shadow styles", () => {
    const set = readFigmaTokens(file());
    expect(set.tokens).toEqual([
      {
        id: "9:10",
        kind: "color",
        name: "color-blue-500",
        values: { "": "#3b82f6" },
        variable: "Primitives/Blue/500",
      },
      {
        id: "7:1007",
        kind: "color",
        name: "color-brand-accent",
        values: { "": "#ff0000" },
        variable: "Brand/Accent",
      },
      {
        alias: "Primitives/Blue/500",
        id: "9:20",
        kind: "color",
        name: "color-primary",
        values: { "": "#3b82f6", dark: "#ffffff" },
        variable: "Semantic/Primary",
      },
      {
        id: "9:11",
        kind: "radius",
        name: "radius-card",
        values: { "": "12px" },
        variable: "Primitives/Radius/Card",
      },
      {
        id: "7:1008",
        kind: "shadow",
        name: "shadow-card",
        values: { "": "0px 4px 8px 0px rgba(0, 0, 0, 0.1)" },
        variable: "Shadow/Card",
      },
    ]);
    expect(set.themes).toEqual(["dark"]);
    expect(set.notes.join(" ")).toContain("Primitives/Opacity/Disabled");
  });
});
