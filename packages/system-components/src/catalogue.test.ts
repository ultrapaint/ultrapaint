import { metaOf } from "@ultrapaint/contracts/catalogue";
import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type {
  AppComponentFile,
  ComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { toCode } from "@ultrapaint/design-document/code";
import { describe, expect, it } from "vitest";
import { catalogueOf } from "./catalogue.ts";

const PLAN: AppComponentFile = {
  category: "Marketing",
  name: "Plan",
  origin: "app",
  properties: [
    { default: "Pro", kind: "text", name: "title", targets: [{ node: "t" }] },
    {
      default: "outline",
      kind: "choice",
      members: ["outline", "primary"],
      name: "tone",
    },
    { default: true, kind: "boolean", name: "badge", targets: [{ node: "t" }] },
  ],
  slots: [{ default: true, name: "body", node: "s" }],
  tree: {
    children: [
      { id: "t", role: "heading", text: "Title", type: "text" },
      { children: [], id: "s", type: "column" },
    ],
    id: "root",
    type: "column",
  },
  version: 1,
};

describe("the catalogue", () => {
  it("is the editor's system components when the project has none of its own", () => {
    const catalogue = catalogueOf([]);
    expect(catalogue.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Button", "Dialog", "Select", "Menu"])
    );
    expect(catalogue.every((c) => c.importFrom === SYSTEM_FROM)).toBe(true);
    expect(
      metaOf(catalogue, { component: "Dialog", from: SYSTEM_FROM })
        ?.slots.filter((s) => s.holds !== undefined)
        .map((s) => s.name)
    ).toEqual(["trigger", "dialog-header", "dialog-content", "dialog-footer"]);
  });

  it("gives the Input an icon slot at its start, which the Code tab writes as its InputIcon part", () => {
    const catalogue = catalogueOf([]);
    expect(
      metaOf(catalogue, { component: "Input", from: SYSTEM_FROM })?.slots.find(
        (s) => s.holds !== undefined
      )
    ).toEqual({
      holds: "nodes",
      label: "Icon",
      layout: "row",
      name: "input-icon",
    });
    const email: DesignNode = {
      children: [
        {
          alt: "",
          id: "mail",
          slot: "input-icon",
          src: "assets/icons/mail.svg",
          type: "image",
        },
      ],
      component: "Input",
      from: SYSTEM_FROM,
      id: "email",
      props: { placeholder: "you@example.com" },
      type: "instance",
    };
    expect(toCode(email, { classes: () => [] }, { catalogue })).toBe(
      `import { Input, InputIcon } from "@/components/ui/input";

<Input placeholder="you@example.com">
  <InputIcon>
    <img alt="" src="assets/icons/mail.svg" />
  </InputIcon>
</Input>`
    );
  });

  it("lists the app components after the system ones: properties as props, choices as axes, slots as parts", () => {
    const look: ComponentFile = {
      base: {},
      name: "Button",
      origin: "system",
      states: {},
      variants: {},
      version: 1,
    };
    const catalogue = catalogueOf([look, PLAN]);
    expect(catalogue.filter((c) => c.name === "Button")).toHaveLength(1);
    const plan = catalogue.at(-1);
    expect(plan?.name).toBe("Plan");
    expect(plan?.importFrom).toBe("#app");
    expect(plan?.category).toBe("Marketing");
    expect(plan?.props.map((p) => [p.name, p.type.kind])).toEqual([
      ["title", "string"],
      ["tone", "enum"],
      ["badge", "boolean"],
    ]);
    expect(plan?.variants).toEqual({ tone: ["outline", "primary"] });
    expect(plan?.slots).toEqual([
      { holds: "default", label: "body", layout: "column", name: "body" },
    ]);
  });

  it("finds an instance's entry by its origin before its name", () => {
    const shadowing = { ...PLAN, name: "Badge" };
    const catalogue = catalogueOf([shadowing]);
    expect(
      metaOf(catalogue, { component: "Badge", from: "#app" })?.importFrom
    ).toBe("#app");
    expect(
      metaOf(catalogue, { component: "Badge", from: SYSTEM_FROM })?.importFrom
    ).toBe(SYSTEM_FROM);
  });

  it("lays an app component's slot out as its container turns in a member or at a breakpoint", () => {
    const turning: AppComponentFile = {
      ...PLAN,
      tree: {
        children: [
          {
            at: { md: { type: "row" }, "tone=primary": { gap: 8 } },
            children: [],
            id: "s",
            type: "column",
          },
        ],
        id: "root",
        type: "column",
      },
    };
    const entry = catalogueOf([turning]).find((e) => e.name === "Plan");
    expect(entry?.slots).toEqual([
      {
        holds: "default",
        label: "body",
        layout: "column",
        layoutIn: { md: "row" },
        name: "body",
      },
    ]);
  });
});
