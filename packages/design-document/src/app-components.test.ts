import type { AppComponentFile } from "@ultrapaint/contracts/components";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  appComponentCycle,
  detachedOf,
  expandAppInstance,
} from "./app-components.ts";
import { makeIdGenerator } from "./ids.ts";
import { childrenOf } from "./tree.ts";

const PLAN: AppComponentFile = {
  name: "Plan",
  origin: "app",
  properties: [
    { default: "Pro", kind: "text", name: "title", targets: [{ node: "t" }] },
    {
      default: "outline",
      kind: "choice",
      members: ["outline", "primary"],
      name: "tone",
      targets: [{ node: "b", prop: "variant" }],
    },
    { default: true, kind: "boolean", name: "badge", targets: [{ node: "g" }] },
  ],
  slots: [{ default: true, name: "body", node: "s" }],
  tree: {
    children: [
      {
        at: { md: { size: 24 }, "tone=primary": { color: "red" } },
        id: "t",
        role: "heading",
        text: "Title",
        type: "text",
      },
      { id: "g", role: "paragraph", text: "New", type: "text" },
      {
        component: "Button",
        from: "@ultrapaint/system",
        id: "b",
        text: "Buy",
        type: "instance",
      },
      {
        children: [{ id: "x", role: "paragraph", text: "…", type: "text" }],
        id: "s",
        type: "column",
      },
    ],
    id: "root",
    type: "column",
  },
  version: 1,
};

const instance = (fields: Partial<InstanceNode> = {}): InstanceNode => ({
  component: "Plan",
  from: "#app",
  id: "plan",
  type: "instance",
  ...fields,
});

describe("expandAppInstance", () => {
  it("draws the tree with the instance's values, its choice's overrides and its children in their slots", () => {
    const { filled, tree } = expandAppInstance(
      PLAN,
      instance({
        children: [
          { id: "mine", role: "paragraph", text: "Mine", type: "text" },
        ],
        props: { badge: false, title: "Team", tone: "primary" },
      })
    );
    expect(tree).toMatchObject({
      children: [
        // A breakpoint's override stays; the variant's is laid over the node.
        { at: { md: { size: 24 } }, color: "red", text: "Team" },
        { hidden: true },
        { props: { variant: "primary" } },
        { children: [{ id: "mine", text: "Mine" }], id: "s" },
      ],
    });
    expect([...filled]).toEqual(["mine"]);
  });

  it("draws the defaults where the instance sets nothing, and a member it lacks as the default", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({ props: { tone: "x" } })
    );
    expect(tree).toMatchObject({
      children: [
        { text: "Pro" },
        { hidden: false },
        { props: { variant: "outline" } },
        { children: [{ id: "x" }] },
      ],
    });
  });
});

describe("an instance's overrides (ADR 0114)", () => {
  it("lay a field over a layer, the main component's other fields kept", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({ overrides: { g: { color: "blue", text: "Hot" } } })
    );
    expect(childrenOf(tree)[1]).toMatchObject({
      color: "blue",
      hidden: false,
      role: "paragraph",
      text: "Hot",
    });
    expect(childrenOf(tree)[0]).toMatchObject({ text: "Pro" });
  });

  it("win over what the chosen member sets, the main's breakpoints kept beside theirs", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({
        overrides: {
          t: { at: { lg: { size: 40 }, md: { weight: 700 } }, color: "green" },
        },
        props: { tone: "primary" },
      })
    );
    expect(childrenOf(tree)[0]).toMatchObject({
      at: { lg: { size: 40 }, md: { size: 24, weight: 700 } },
      color: "green",
    });
  });

  it("set a nested instance's props over its own, and hand it the overrides of its layers", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({
        overrides: {
          b: { props: { size: "sm" } },
          "b/label": { color: "red" },
          "b/label/deeper": { hidden: true },
        },
      })
    );
    expect(childrenOf(tree)[2]).toMatchObject({
      id: "b",
      overrides: { label: { color: "red" }, "label/deeper": { hidden: true } },
      props: { size: "sm", variant: "outline" },
    });
  });

  it("turn a container's kind, never a text's", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({ overrides: { g: { type: "row" }, s: { type: "row" } } })
    );
    expect(childrenOf(tree)[1]?.type).toBe("text");
    expect(childrenOf(tree)[3]?.type).toBe("row");
  });

  it("never turn a container into anything but a container", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({ overrides: { s: { type: "text" } } })
    );
    expect(childrenOf(tree)[3]?.type).toBe("column");
  });

  it("hand a nested instance a container's new kind for its layer", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({ overrides: { "b/body": { type: "row" } } })
    );
    expect(childrenOf(tree)[2]).toMatchObject({
      overrides: { body: { type: "row" } },
    });
  });

  it("are left out for a layer the main component no longer has", () => {
    const { tree } = expandAppInstance(
      PLAN,
      instance({ overrides: { gone: { color: "red" } } })
    );
    expect(childrenOf(tree).map((layer) => layer.id)).toEqual([
      "t",
      "g",
      "b",
      "s",
    ]);
    expect(
      childrenOf(tree).some(
        (layer) => "color" in layer && layer.color === "red"
      )
    ).toBe(false);
  });

  it("are baked in when the instance is detached", () => {
    const tree = detachedOf(
      PLAN,
      instance({ overrides: { g: { text: "Hot" } } }),
      makeIdGenerator()
    );
    expect(childrenOf(tree)[1]).toMatchObject({ text: "Hot" });
  });
});

describe("detachedOf", () => {
  it("gives the nodes new ids, keeps the page's children and where the instance sat", () => {
    const tree = detachedOf(
      PLAN,
      instance({
        children: [
          { id: "mine", role: "paragraph", text: "Mine", type: "text" },
        ],
        width: "fill",
      }),
      makeIdGenerator()
    );
    expect(tree.id).not.toBe("root");
    expect(tree).toMatchObject({ type: "column", width: "fill" });
    const ids = JSON.stringify(tree);
    expect(ids).toContain('"mine"');
    expect(ids).not.toContain('"t"');
  });
});

describe("appComponentCycle", () => {
  it("finds a component that places itself through another", () => {
    const placing = (name: string, inner: string): AppComponentFile => ({
      ...PLAN,
      name,
      tree: {
        children: [
          { component: inner, from: "#app", id: "i", type: "instance" },
        ],
        id: "r",
        type: "row",
      },
    });
    expect(appComponentCycle([placing("A", "B"), placing("B", "A")])).toEqual([
      "A",
      "B",
      "A",
    ]);
    expect(appComponentCycle([placing("A", "B"), PLAN])).toBeNull();
  });
});
