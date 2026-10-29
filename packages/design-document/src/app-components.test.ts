import type { AppComponentFile } from "@ultrapaint/contracts/components";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  appComponentCycle,
  appComponentMeta,
  detachedOf,
  expandAppInstance,
} from "./app-components.ts";
import { makeIdGenerator } from "./ids.ts";

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

describe("appComponentMeta", () => {
  it("lists the properties as props, the choices as axes and the slots as a system component's", () => {
    const meta = appComponentMeta(PLAN);
    expect(meta.importFrom).toBe("#app");
    expect(meta.props.map((p) => [p.name, p.type.kind])).toEqual([
      ["title", "string"],
      ["tone", "enum"],
      ["badge", "boolean"],
    ]);
    expect(meta.variants).toEqual({ tone: ["outline", "primary"] });
    expect(meta.slots).toEqual([
      { holds: "default", label: "body", layout: "column", name: "body" },
    ]);
  });
});
