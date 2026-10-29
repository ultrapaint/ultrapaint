import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { PRIMITIVES_FROM } from "@ultrapaint/contracts/spec-names";
import { describe, expect, it } from "vitest";
import { primitiveOf } from "./catalogue.ts";
import { asPrimitive, migrationOf, primitiveFor } from "./migrate.ts";

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

describe("primitiveFor", () => {
  it("finds a primitive by a component's name, case aside, and by shadcn's names", () => {
    expect(primitiveFor("button")?.name).toBe("Button");
    expect(primitiveFor("DropdownMenu")?.name).toBe("Menu");
    expect(primitiveFor("Sonner")?.name).toBe("Toast");
    expect(primitiveFor("Spinner")?.name).toBe("Spinner");
    expect(primitiveFor("DataTable")).toBeUndefined();
  });
});

describe("asPrimitive", () => {
  it("maps shadcn's variant values onto the primitive's axes, keeping its text", () => {
    expect(
      asPrimitive(
        instance("b", "Button", {
          props: { onClick: "x", size: "default", variant: "default" },
          text: "New order",
          width: 120,
        })
      )
    ).toEqual({
      component: "Button",
      from: PRIMITIVES_FROM,
      id: "b",
      props: { size: "md", variant: "primary" },
      text: "New order",
      type: "instance",
      width: 120,
    });
  });

  it("keeps a member the primitive has and drops one it lacks", () => {
    expect(
      asPrimitive(
        instance("b", "Button", {
          props: { size: "icon-xs", variant: "outline" },
        })
      ).props
    ).toEqual({ variant: "outline" });
  });

  it("maps props set at a breakpoint too", () => {
    expect(
      asPrimitive(
        instance("b", "Button", { at: { md: { props: { size: "default" } } } })
      ).at
    ).toEqual({ md: { props: { size: "md" } } });
  });

  it("takes a compound component apart into the primitive's slots and props", () => {
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
    const drawn = asPrimitive(dialog);
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
      ["open", "trigger", PRIMITIVES_FROM],
      ["p", undefined, false],
      ["ok", "dialog-footer", PRIMITIVES_FROM],
    ]);
  });

  it("makes a menu's items its list, and a part with text and no slot a text node", () => {
    const menu = asPrimitive(
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

  it("draws an instance as the primitive it is given", () => {
    const meta = primitiveOf("Badge");
    expect(
      asPrimitive(instance("x", "StatusPill", { text: "Paid" }), meta)
    ).toMatchObject({
      component: "Badge",
      from: PRIMITIVES_FROM,
      text: "Paid",
    });
  });
});

describe("migrationOf", () => {
  it("replaces the outermost instances a primitive draws and counts those inside them", () => {
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
      from: PRIMITIVES_FROM,
      id: "b",
      slot: "card-footer",
    });
  });

  it("leaves primitives and drafts as they are", () => {
    const root: DesignNode = {
      children: [
        {
          component: "Button",
          from: PRIMITIVES_FROM,
          id: "a",
          type: "instance",
        },
        { component: "Hero", from: "#draft", id: "b", type: "instance" },
      ],
      id: "page",
      type: "page",
    };
    expect(migrationOf(root)).toEqual({ drawn: 0, left: [], replaced: [] });
  });
});
