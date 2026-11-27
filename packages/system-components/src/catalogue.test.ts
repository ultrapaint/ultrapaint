import { metaOf } from "@ultrapaint/contracts/catalogue";
import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type {
  AppComponentFile,
  ComponentFile,
  SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { toCode } from "@ultrapaint/design-document/code";
import { describe, expect, it } from "vitest";
import { catalogueOf } from "./catalogue.ts";
import { lookOf } from "./defaults.ts";

/** Badge's built-in members (UP-252): the neutral three, the destructive, the three statuses. */
const BADGE_MEMBERS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "warning",
  "success",
  "info",
];

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

  describe("a system component's members as the project's look makes them (ADR 0161)", () => {
    const badge = (
      members: SystemComponentFile["members"]
    ): SystemComponentFile => ({
      base: {},
      ...(members && { members }),
      name: "Badge",
      origin: "system",
      states: {},
      variants: {},
      version: 1,
    });
    const entryOf = (look: SystemComponentFile) =>
      metaOf(catalogueOf([look]), { component: "Badge", from: SYSTEM_FROM });

    it("offers a member the look adds to an axis after the catalogue's, in the axis and its prop", () => {
      const entry = entryOf(badge({ variant: { add: ["neutral-strong"] } }));
      expect(entry?.variants).toEqual({
        variant: [...BADGE_MEMBERS, "neutral-strong"],
      });
      expect(entry?.props.find((p) => p.name === "variant")).toEqual({
        defaultValue: "default",
        name: "variant",
        type: {
          kind: "enum",
          members: [...BADGE_MEMBERS, "neutral-strong"],
        },
      });
    });

    it("gives an axis of the project's own a prop of its own, starting in its first member", () => {
      const entry = entryOf(badge({ shape: { add: ["default", "pill"] } }));
      expect(entry?.variants).toEqual({
        shape: ["default", "pill"],
        variant: BADGE_MEMBERS,
      });
      expect(entry?.props.at(-1)).toEqual({
        defaultValue: "default",
        name: "shape",
        type: { kind: "enum", members: ["default", "pill"] },
      });
    });

    it("no longer offers a member the look takes out, and starts a new instance in one it offers", () => {
      const entry = entryOf(
        badge({ variant: { add: ["neutral"], remove: ["default", "outline"] } })
      );
      expect(entry?.variants.variant).toEqual([
        "secondary",
        "destructive",
        "warning",
        "success",
        "info",
        "neutral",
      ]);
      expect(entry?.example).toEqual({ variant: "secondary" });
      expect(
        lookOf(badge({ variant: { add: ["neutral"], remove: ["default"] } }))
          ?.defaults
      ).toEqual({ variant: "secondary" });
    });

    it("is written as code with the product's members as the component's own props", () => {
      const catalogue = catalogueOf([
        badge({
          shape: { add: ["default", "pill"] },
          variant: { add: ["neutral-strong"] },
        }),
      ]);
      const placed: DesignNode = {
        component: "Badge",
        from: SYSTEM_FROM,
        id: "b",
        props: { shape: "pill", variant: "neutral-strong" },
        text: "Beta",
        type: "instance",
      };
      expect(toCode(placed, { classes: () => [] }, { catalogue })).toBe(
        `import { Badge } from "@/components/ui/badge";

<Badge shape="pill" variant="neutral-strong">Beta</Badge>`
      );
    });

    it("is the catalogue's own for a look that adds and takes out nothing", () => {
      expect(entryOf(badge(undefined))).toEqual(entryOf(badge({})));
      expect(entryOf(badge({}))).toEqual(
        metaOf(catalogueOf([]), { component: "Badge", from: SYSTEM_FROM })
      );
    });
  });
});

describe("Badge's built-in members (UP-252)", () => {
  const badge = metaOf(catalogueOf([]), {
    component: "Badge",
    from: SYSTEM_FROM,
  });

  it("offers seven, the statuses after the destructive, in the axis and its Variant field", () => {
    expect(badge?.variants).toEqual({ variant: BADGE_MEMBERS });
    expect(badge?.props).toEqual([
      {
        defaultValue: "default",
        name: "variant",
        type: { kind: "enum", members: BADGE_MEMBERS },
      },
    ]);
  });

  it("writes a status badge as code in the product's member", () => {
    const placed: DesignNode = {
      component: "Badge",
      from: SYSTEM_FROM,
      id: "b",
      props: { variant: "warning" },
      text: "Overdue",
      type: "instance",
    };
    expect(
      toCode(placed, { classes: () => [] }, { catalogue: catalogueOf([]) })
    ).toBe(
      `import { Badge } from "@/components/ui/badge";

<Badge variant="warning">Overdue</Badge>`
    );
  });
});
