import { describe, expect, it } from "vitest";
import { readFig } from "./fig.ts";
import { makeFixture, solid } from "./testing/fixture.ts";
import { readFigmaTokens } from "./tokens.ts";

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
  it("names a variable by its collection and its name, a collection nobody named left out", () => {
    const fixture = makeFixture();
    const unnamed = fixture.add(fixture.internal, {
      guid: guid(1),
      name: "Collection 1",
      type: "VARIABLE_SET",
      variableSetModes: [mode(2, "Mode 1")],
    } as never);
    const variable = (
      localID: number,
      name: string,
      type: string,
      data: unknown
    ) =>
      fixture.add(fixture.internal, {
        guid: guid(localID),
        name,
        type: "VARIABLE",
        variableDataValues: {
          entries: [{ modeID: guid(2), variableData: data }],
        },
        variableResolvedType: type,
        variableSetID: { guid: unnamed },
      } as never);
    variable(10, "Color/Primary", "COLOR", color(0, 0, 1));
    variable(11, "Color/Text/Primary", "COLOR", color(0, 0, 0));
    variable(12, "Rounded/lg", "FLOAT", float(8));
    variable(13, "Flags/Beta", "BOOLEAN", {
      dataType: "BOOLEAN",
      resolvedDataType: "BOOLEAN",
      value: { boolValue: true },
    });
    const set = readFigmaTokens(readFig(fixture.build()));
    expect(set.tokens.map((t) => [t.name, t.values[""], t.variable])).toEqual([
      ["color-primary", "#0000ff", "Collection 1/Color/Primary"],
      ["color-text-primary", "#000000", "Collection 1/Color/Text/Primary"],
      ["radius-lg", "8px", "Collection 1/Rounded/lg"],
    ]);
    expect(set.notes.join(" ")).toContain("Collection 1/Flags/Beta");
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

  it("takes the light mode as the default wherever it comes among a collection's modes", () => {
    const fixture = makeFixture();
    const semantic = fixture.add(fixture.internal, {
      guid: guid(3),
      name: "Semantic",
      type: "VARIABLE_SET",
      variableSetModes: [mode(4, "Dark"), mode(5, "Light"), mode(6, "Dim")],
    } as never);
    const variable = (localID: number, name: string, entries: unknown[]) =>
      fixture.add(fixture.internal, {
        guid: guid(localID),
        name,
        type: "VARIABLE",
        variableDataValues: { entries },
        variableResolvedType: "COLOR",
        variableSetID: { guid: semantic },
      } as never);
    variable(20, "Color/Background", [
      { modeID: guid(4), variableData: color(0, 0, 0) },
      { modeID: guid(5), variableData: color(1, 1, 1) },
      { modeID: guid(6), variableData: color(1, 1, 1) },
    ]);
    // A mode a variable says nothing in is the default's, the light one's.
    variable(21, "Color/Border", [
      { modeID: guid(5), variableData: color(0, 0, 1) },
    ]);
    const set = readFigmaTokens(readFig(fixture.build()));
    expect(set.tokens.map((t) => [t.name, t.values])).toEqual([
      ["color-background", { "": "#ffffff", dark: "#000000" }],
      ["color-border", { "": "#0000ff" }],
    ]);
    expect(set.themes).toEqual(["dark"]);
  });
});
