import type { AppComponentFile } from "@ultrapaint/contracts/components";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  findLayer,
  instanceLayerOf,
  isLayerOf,
  layerOwner,
  layerPath,
  overridesAsMainOps,
  ownLayersOf,
  throughProperties,
} from "./instance-layers.ts";
import { childrenOf } from "./tree.ts";

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
  it("are reached through the instances that draw them, as they draw them", () => {
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

  it("are nothing where no app component has such a layer", () => {
    expect(findLayer(PAGE, "shell/gone", fileOf)).toBeNull();
    expect(findLayer(PAGE, "title/x", fileOf)).toBeNull();
  });

  it("name the instance that draws them, innermost first", () => {
    expect(layerOwner(PAGE, "shell/nav/text", fileOf)?.id).toBe("shell/nav");
    expect(layerOwner(PAGE, "shell/side", fileOf)?.id).toBe("shell");
  });

  it("are kept on the page's instance under the way to them from it", () => {
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
  it("are each layer's fields, breakpoints and props set in the component", () => {
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

describe("an instance's own layers (ADR 0114)", () => {
  it("are the component's as the instance draws them, without the page's nodes in its slots", () => {
    const [shell] = childrenOf(PAGE);
    const layers = shell ? ownLayersOf(shell, fileOf) : [];
    expect(JSON.stringify(layers)).not.toContain('"title"');
    expect(layers.map((l) => l.id)).toEqual(["shell/side", "shell/main"]);
    expect(layers[0]).toMatchObject({ fill: "#000" });
  });
});

describe("an edit of an instance's layer, at its edges (ADR 0114)", () => {
  const OUTER: AppComponentFile = {
    ...SHELL,
    name: "Outer",
    properties: [
      {
        default: false,
        kind: "boolean",
        name: "aside",
        targets: [{ node: "side" }],
      },
    ],
  };
  const files = new Map([...FILES, [OUTER.name, OUTER]]);
  const page = (extra: DesignNode[] = []): DesignNode => ({
    children: [
      { component: "Outer", from: "#app", id: "shell", type: "instance" },
      ...extra,
    ],
    id: "page",
    type: "page",
  });
  const routed = (ops: DocOp[], root = page()) =>
    throughProperties(ops, root, (n) => files.get(n));

  it("gives a boolean property back to its default when the layer's visibility is", () => {
    expect(
      routed([{ id: "shell/side", op: "update", set: { hidden: null } }])
    ).toEqual([{ id: "shell", op: "setProps", props: { aside: null } }]);
  });

  it("hides a layer through the property that shows it", () => {
    expect(routed([{ id: "shell/side", op: "remove" }])).toEqual([
      { id: "shell", op: "setProps", props: { aside: false } },
    ]);
  });

  it("leaves an edit of a page's node whose own id has a slash to that node", () => {
    const op: DocOp = { id: "shell/side", op: "update", set: { hidden: true } };
    const slashed = page([
      { id: "shell/side", role: "paragraph", text: "Mine", type: "text" },
    ]);
    expect(routed([op], slashed)).toEqual([op]);
    expect(isLayerOf(slashed, "shell/side")).toBe(false);
    expect(isLayerOf(page(), "shell/side")).toBe(true);
  });

  it("applies a breakpoint's props to the main component prop by prop", () => {
    expect(
      overridesAsMainOps({
        nav: { at: { md: { gap: 4, props: { label: "Hi" } } } },
      })
    ).toEqual([
      { at: "md", id: "nav", op: "update", set: { gap: 4 } },
      { at: "md", id: "nav", op: "setProps", props: { label: "Hi" } },
    ]);
  });
});
