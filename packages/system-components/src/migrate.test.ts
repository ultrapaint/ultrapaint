import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { systemComponentOf } from "./catalogue.ts";
import {
  asSystemComponent,
  componentOfSpec,
  LEGACY_SYSTEM_FROM,
  migrationOf,
  systemComponentFor,
} from "./migrate.ts";

const instance = (
  id: string,
  component: string,
  extra: Partial<InstanceNode> = {}
): InstanceNode => ({
  component,
  from: `@/components/ui/${component.toLowerCase()}`,
  id,
  type: "instance",
  ...extra,
});

describe("systemComponentFor", () => {
  it("finds a system component by a component's name, case aside, and by shadcn's names", () => {
    expect(systemComponentFor("button")?.name).toBe("Button");
    expect(systemComponentFor("DropdownMenu")?.name).toBe("Menu");
    expect(systemComponentFor("Sonner")?.name).toBe("Toast");
    expect(systemComponentFor("Spinner")?.name).toBe("Spinner");
    expect(systemComponentFor("DataTable")).toBeUndefined();
  });
});

describe("asSystemComponent", () => {
  it("maps shadcn's variant values onto the system component's axes, keeping its text", () => {
    expect(
      asSystemComponent(
        instance("b", "Button", {
          props: { onClick: "x", size: "default", variant: "default" },
          text: "New order",
          width: 120,
        })
      )
    ).toEqual({
      component: "Button",
      from: SYSTEM_FROM,
      id: "b",
      props: { size: "md", variant: "primary" },
      text: "New order",
      type: "instance",
      width: 120,
    });
  });

  it("keeps a member the system component has and drops one it lacks", () => {
    expect(
      asSystemComponent(
        instance("b", "Button", {
          props: { size: "icon-xs", variant: "outline" },
        })
      ).props
    ).toEqual({ variant: "outline" });
  });

  it("maps props set at a breakpoint too", () => {
    expect(
      asSystemComponent(
        instance("b", "Button", { at: { md: { props: { size: "default" } } } })
      ).at
    ).toEqual({ md: { props: { size: "md" } } });
  });

  it("takes a compound component apart into the system component's slots and props", () => {
    const dialog = instance("d", "Dialog", {
      children: [
        instance("t", "DialogTrigger", {
          children: [instance("open", "Button", { text: "Open" })],
        }),
        instance("c", "DialogContent", {
          children: [
            instance("h", "DialogHeader", {
              children: [
                instance("ti", "DialogTitle", { text: "Delete it?" }),
                instance("de", "DialogDescription", {
                  children: [
                    {
                      id: "x",
                      role: "paragraph",
                      text: "For good.",
                      type: "text",
                    },
                  ],
                }),
              ],
            }),
            { id: "p", role: "paragraph", text: "Body", type: "text" },
            instance("f", "DialogFooter", {
              children: [instance("ok", "Button", { text: "Delete" })],
            }),
          ],
        }),
      ],
      props: { open: true },
    });
    const drawn = asSystemComponent(dialog);
    expect(drawn.props).toEqual({
      description: "For good.",
      open: true,
      title: "Delete it?",
    });
    expect(
      drawn.children?.map((c) => [
        c.id,
        c.slot,
        c.type === "instance" && c.from,
      ])
    ).toEqual([
      ["open", "trigger", SYSTEM_FROM],
      ["p", undefined, false],
      ["ok", "dialog-footer", SYSTEM_FROM],
    ]);
  });

  it("makes a menu's items its list, and a part with text and no slot a text node", () => {
    const menu = asSystemComponent(
      instance("m", "DropdownMenu", {
        children: [
          instance("tr", "DropdownMenuTrigger", { text: "Open" }),
          instance("co", "DropdownMenuContent", {
            children: [
              instance("a", "DropdownMenuItem", { text: "Profile" }),
              instance("s", "DropdownMenuSeparator"),
              instance("b", "DropdownMenuItem", { text: "Sign out" }),
            ],
          }),
        ],
      })
    );
    expect(menu.component).toBe("Menu");
    expect(menu.props).toEqual({ items: ["Profile", "-", "Sign out"] });
    expect(menu.children).toEqual([
      { id: "tr", role: "paragraph", text: "Open", type: "text" },
    ]);
  });

  it("draws an instance as the system component it is given", () => {
    const meta = systemComponentOf("Badge");
    expect(
      asSystemComponent(instance("x", "StatusPill", { text: "Paid" }), meta)
    ).toMatchObject({
      component: "Badge",
      from: SYSTEM_FROM,
      text: "Paid",
    });
  });
});

describe("migrationOf", () => {
  it("replaces the outermost instances a system component draws and counts those inside them", () => {
    const root: DesignNode = {
      children: [
        instance("card", "Card", {
          children: [
            instance("cf", "CardFooter", {
              children: [instance("b", "Button", { text: "Go" })],
            }),
          ],
        }),
        {
          children: [instance("chart", "Chart"), instance("sp", "Spinner")],
          id: "row",
          type: "row",
        },
      ],
      id: "page",
      type: "page",
    };
    const migration = migrationOf(root);
    expect(migration.drawn).toBe(3);
    expect(migration.left).toEqual(["Chart"]);
    expect(migration.replaced.map((n) => n.id)).toEqual(["card", "sp"]);
    expect(migration.replaced[0]?.children?.[0]).toMatchObject({
      component: "Button",
      from: SYSTEM_FROM,
      id: "b",
      slot: "card-footer",
    });
  });

  it("leaves system components and app components as they are", () => {
    const root: DesignNode = {
      children: [
        {
          component: "Button",
          from: SYSTEM_FROM,
          id: "a",
          type: "instance",
        },
        { component: "Hero", from: "#app", id: "b", type: "instance" },
      ],
      id: "page",
      type: "page",
    };
    expect(migrationOf(root)).toEqual({ drawn: 0, left: [], replaced: [] });
  });

  it("names a system component's instance from before ADR 0041 as now, keeping what it holds", () => {
    const root: DesignNode = {
      children: [
        {
          children: [
            {
              component: "Button",
              from: LEGACY_SYSTEM_FROM,
              id: "ok",
              slot: "card-footer",
              type: "instance",
            },
          ],
          component: "Card",
          from: LEGACY_SYSTEM_FROM,
          id: "card",
          props: { title: "Plan" },
          type: "instance",
        },
      ],
      id: "page",
      type: "page",
    };
    const migration = migrationOf(root);
    expect(migration.drawn).toBe(2);
    expect(migration.replaced).toEqual([
      {
        children: [
          {
            component: "Button",
            from: SYSTEM_FROM,
            id: "ok",
            slot: "card-footer",
            type: "instance",
          },
        ],
        component: "Card",
        from: SYSTEM_FROM,
        id: "card",
        props: { title: "Plan" },
        type: "instance",
      },
    ]);
  });

  it("makes a draft's instance an app component's, its text the text property's value", () => {
    const root: DesignNode = {
      children: [
        {
          component: "Promo",
          from: "#draft",
          id: "p",
          text: "Spring sale",
          type: "instance",
        },
      ],
      id: "page",
      type: "page",
    };
    expect(migrationOf(root).replaced).toEqual([
      {
        component: "Promo",
        from: "#app",
        id: "p",
        props: { text: "Spring sale" },
        type: "instance",
      },
    ]);
  });
});

describe("componentOfSpec", () => {
  const spec = {
    base: { root: { fill: "$color-brand" } },
    component: "Button",
    from: LEGACY_SYSTEM_FROM,
    look: "design" as const,
    states: {},
    variants: {},
  };

  it("makes a spec with the design's look the system component's file, and drops a mirror", () => {
    expect(componentOfSpec(spec)).toEqual({
      base: { root: { fill: "$color-brand" } },
      name: "Button",
      origin: "system",
      states: {},
      variants: {},
      version: 1,
    });
    expect(componentOfSpec({ ...spec, look: "code" })).toBeNull();
    expect(componentOfSpec({ ...spec, component: "DataTable" })).toBeNull();
  });

  it("makes a draft an app component, its first text bound to a text property", () => {
    const app = componentOfSpec({
      ...spec,
      component: "Promo",
      draft: {
        children: [
          { id: "t", role: "heading", text: "Sale", type: "text" },
          {
            component: "Button",
            from: LEGACY_SYSTEM_FROM,
            id: "b",
            type: "instance",
          },
        ],
        id: "r",
        type: "column",
      },
      from: "#draft",
    });
    expect(app).toMatchObject({
      name: "Promo",
      origin: "app",
      properties: [
        {
          default: "Sale",
          kind: "text",
          name: "text",
          targets: [{ node: "t" }],
        },
      ],
      slots: [],
    });
    expect(
      app?.origin === "app" && "children" in app.tree
        ? app.tree.children?.[1]
        : null
    ).toMatchObject({ from: SYSTEM_FROM });
  });
});
