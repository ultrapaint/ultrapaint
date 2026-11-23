import type { AppComponentFile } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  findLayer,
  instanceLayerOf,
  layerOwner,
  layerPath,
  overridesAsMainOps,
  throughProperties,
} from "./instance-layers.ts";

const NAV_ITEM: AppComponentFile = {
  name: "NavItem",
  origin: "app",
  properties: [
    {
      default: "Item",
      kind: "text",
      name: "label",
      targets: [{ node: "text" }],
    },
  ],
  slots: [],
  tree: {
    children: [{ id: "text", role: "paragraph", text: "Item", type: "text" }],
    id: "item",
    type: "row",
  },
  version: 1,
};

const SHELL: AppComponentFile = {
  name: "Shell",
  origin: "app",
  properties: [],
  slots: [{ default: true, name: "main", node: "main" }],
  tree: {
    children: [
      {
        children: [
          {
            component: "NavItem",
            from: "#app",
            id: "nav",
            props: { label: "Home" },
            type: "instance",
          },
        ],
        id: "side",
        type: "column",
      },
      { children: [], id: "main", type: "column" },
    ],
    id: "root",
    type: "row",
  },
  version: 1,
};

const FILES = new Map([
  [NAV_ITEM.name, NAV_ITEM],
  [SHELL.name, SHELL],
]);
const fileOf = (name: string) => FILES.get(name);

const PAGE: DesignNode = {
  children: [
    {
      children: [{ id: "title", role: "heading", text: "Hi", type: "text" }],
      component: "Shell",
      from: "#app",
      id: "shell",
      overrides: {
        "nav/text": { color: "red" },
        side: { fill: "#000" },
      },
      type: "instance",
    },
  ],
  id: "page",
  type: "page",
};

describe("an instance's layers (ADR 0114)", () => {
  it("are reached through the instances that draw them, the overrides laid over them", () => {
    const path = layerPath(PAGE, "shell/nav/text", fileOf);
    expect(path?.map((n) => n.id)).toEqual([
      "page",
      "shell",
      "shell/side",
      "shell/nav",
      "shell/nav/text",
    ]);
    expect(path?.[2]).toMatchObject({ fill: "#000" });
    expect(path?.at(-1)).toMatchObject({ color: "red", text: "Home" });
  });

  it("are the same objects each time the instance and the component stay the same", () => {
    expect(findLayer(PAGE, "shell/nav/text", fileOf)).toBe(
      findLayer(PAGE, "shell/nav/text", fileOf)
    );
  });

  it("keep the page's own nodes where the document has them", () => {
    expect(layerPath(PAGE, "title", fileOf)?.map((n) => n.id)).toEqual([
      "page",
      "shell",
      "title",
    ]);
  });

  it("are nothing where the component has no such layer, or is not an app component", () => {
    expect(findLayer(PAGE, "shell/gone", fileOf)).toBeNull();
    expect(findLayer(PAGE, "title/x", fileOf)).toBeNull();
  });

  it("name the instance that draws them, and the key of their overrides", () => {
    expect(layerOwner(PAGE, "shell/nav/text", fileOf)?.id).toBe("shell/nav");
    expect(layerOwner(PAGE, "shell/side", fileOf)?.id).toBe("shell");
    expect(instanceLayerOf("shell/nav/text")).toEqual({
      instance: "shell",
      layer: "nav/text",
    });
  });
});

describe("an edit of an instance's layer (ADR 0114)", () => {
  const OUTER: AppComponentFile = {
    ...SHELL,
    name: "Outer",
    properties: [
      {
        default: "Home",
        kind: "text",
        name: "first",
        targets: [{ node: "nav", prop: "label" }],
      },
      {
        default: true,
        kind: "boolean",
        name: "aside",
        targets: [{ node: "side" }],
      },
    ],
  };
  const files = new Map([...FILES, [OUTER.name, OUTER]]);
  const page = (component: string): DesignNode => ({
    children: [{ component, from: "#app", id: "shell", type: "instance" }],
    id: "page",
    type: "page",
  });

  it("sets the property a field is, on the instance that draws the layer", () => {
    expect(
      throughProperties(
        [
          {
            id: "shell/nav/text",
            op: "update",
            set: { color: "red", text: "Hi" },
          },
        ],
        page("Shell"),
        (n) => files.get(n)
      )
    ).toEqual([
      { id: "shell/nav", op: "setProps", props: { label: "Hi" } },
      { id: "shell/nav/text", op: "update", set: { color: "red" } },
    ]);
  });

  it("follows a property through the instances that expose it, to the page's instance", () => {
    expect(
      throughProperties(
        [{ at: "md", id: "shell/nav/text", op: "update", set: { text: "Hi" } }],
        page("Outer"),
        (n) => files.get(n)
      )
    ).toEqual([
      { at: "md", id: "shell", op: "setProps", props: { first: "Hi" } },
    ]);
  });

  it("shows or hides a layer through its boolean property", () => {
    expect(
      throughProperties(
        [{ id: "shell/side", op: "update", set: { hidden: true } }],
        page("Outer"),
        (n) => files.get(n)
      )
    ).toEqual([{ id: "shell", op: "setProps", props: { aside: false } }]);
  });

  it("leaves an edit of the document's own nodes as it is", () => {
    const op = { id: "title", op: "update", set: { text: "x" } } as const;
    expect(throughProperties([op], page("Shell"), (n) => files.get(n))).toEqual(
      [op]
    );
  });
});

describe("an instance's overrides applied to its main component (ADR 0114)", () => {
  it("set each layer's fields, breakpoints and props in the component, a nested layer as its instance's override", () => {
    expect(
      overridesAsMainOps({
        nav: { props: { label: "Home" } },
        "nav/text": { color: "red" },
        side: { at: { md: { gap: 8 } }, fill: "#000" },
      })
    ).toEqual([
      { id: "nav", op: "setProps", props: { label: "Home" } },
      { id: "nav/text", op: "update", set: { color: "red" } },
      { id: "side", op: "update", set: { fill: "#000" } },
      { at: "md", id: "side", op: "update", set: { gap: 8 } },
    ]);
  });
});
