import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { classesOf, pageComponentName, toCode } from "./code.ts";

const ds = {
  ...emptyDesignSystem(),
  typography: {
    fonts: [],
    sizes: [{ lineHeight: "1.75rem", name: "text-lg", value: "1.125rem" }],
    styles: [
      {
        name: "Title",
        role: "heading" as const,
        size: "$text-lg",
        weight: 700,
      },
      {
        group: "body" as const,
        lineHeight: "$leading-relaxed",
        name: "Body lg",
        role: "paragraph" as const,
        size: "$text-lg",
        weight: "$font-weight-normal",
      },
    ],
    weights: [],
  },
};

describe("classesOf", () => {
  it("writes tokens as the utilities Tailwind generates from their names", () => {
    const node: DesignNode = {
      children: [],
      fill: "$color-primary",
      gap: "$spacing-4",
      id: "r",
      padding: { bottom: 4, left: 8, right: 8, top: 4 },
      radius: "$radius-lg",
      shadow: "$shadow-md",
      type: "row",
    };
    expect(classesOf(node, ds)).toEqual([
      "flex",
      "gap-4",
      "px-2",
      "py-1",
      "bg-primary",
      "rounded-lg",
      "shadow-md",
    ]);
  });

  it("puts pixels on the spacing scale and only off it in brackets", () => {
    const node: DesignNode = {
      children: [],
      gap: 10,
      id: "c",
      padding: 16,
      type: "column",
      width: 320,
    };
    expect(classesOf(node, ds, "block")).toEqual([
      "flex",
      "flex-col",
      "gap-2.5",
      "w-80",
      "p-4",
    ]);
    expect(classesOf({ ...node, gap: 13 }, ds)).toContain("gap-[13px]");
  });

  it("writes margin as padding is written, below zero with a minus", () => {
    const node: DesignNode = {
      children: [],
      id: "r",
      margin: { bottom: 16, left: 8, right: 8, top: -4 },
      type: "row",
    };
    expect(classesOf(node, ds)).toEqual(["flex", "mx-2", "-mt-1", "mb-4"]);
    expect(classesOf({ ...node, margin: 24 }, ds)).toContain("m-6");
  });

  it("sizes fill and hug relative to the parent's layout", () => {
    const node: DesignNode = {
      height: "hug",
      id: "t",
      role: "paragraph",
      text: "Hi",
      type: "text",
      width: "fill",
    };
    expect(classesOf(node, ds, "row")).toEqual([
      "flex-1",
      "min-w-0",
      "h-fit",
      "self-start",
    ]);
    expect(classesOf(node, ds, "column")).toEqual([
      "self-stretch",
      "h-fit",
      "shrink-0",
    ]);
    expect(classesOf(node, ds, "block")).toEqual(["w-full", "h-fit"]);
  });

  it("sets text in its text style with the node's own settings over it", () => {
    const node: DesignNode = {
      color: "$color-muted-foreground",
      id: "h",
      level: 2,
      role: "heading",
      text: "Title",
      textStyle: "Title",
      type: "text",
      weight: "$font-weight-medium",
    };
    expect(classesOf(node, ds)).toEqual([
      "text-lg",
      "font-medium",
      "text-muted-foreground",
    ]);
  });

  it("writes a text style as its size, weight and line height classes", () => {
    const node: DesignNode = {
      id: "p",
      role: "paragraph",
      text: "Body",
      textStyle: "Body lg",
      type: "text",
    };
    expect(classesOf(node, ds)).toEqual([
      "text-lg",
      "font-normal",
      "leading-relaxed",
    ]);
    // Detached, the same settings on the node itself write the same classes.
    const detached: DesignNode = {
      id: "p",
      lineHeight: "$leading-relaxed",
      role: "paragraph",
      size: "$text-lg",
      text: "Body",
      type: "text",
      weight: "$font-weight-normal",
    };
    expect(classesOf(detached, ds)).toEqual(classesOf(node, ds));
  });

  it("keeps a token of another namespace as its variable", () => {
    const node: DesignNode = {
      children: [],
      fill: "$radius-lg",
      id: "g",
      type: "group",
    };
    expect(classesOf(node, ds)).toEqual(["bg-(--radius-lg)"]);
  });

  it("writes plain CSS as arbitrary values", () => {
    const node: DesignNode = {
      border: { color: "#e5e5e5", style: "dashed", width: 2 },
      children: [],
      fill: "#fafafa",
      id: "g",
      opacity: 0.5,
      shadow: "0 1px 2px rgba(0, 0, 0, 0.1)",
      type: "group",
    };
    expect(classesOf(node, ds)).toEqual([
      "bg-[#fafafa]",
      "border-2",
      "border-dashed",
      "border-[#e5e5e5]",
      "shadow-[0_1px_2px_rgba(0,_0,_0,_0.1)]",
      "opacity-50",
    ]);
  });
});

describe("toCode", () => {
  const page: PageNode = {
    children: [
      {
        children: [
          {
            id: "title",
            level: 1,
            role: "heading",
            text: "Pricing",
            type: "text",
          },
          {
            component: "Button",
            from: "@acme/ui/button",
            id: "cta",
            props: { disabled: true, size: 2, variant: "outline" },
            text: "Start",
            type: "instance",
          },
          {
            hidden: true,
            id: "draft",
            name: "Draft",
            role: "paragraph",
            text: "Later",
            type: "text",
          },
        ],
        gap: 16,
        id: "hero",
        type: "column",
        width: "fill",
      },
      {
        component: "Badge",
        from: "@acme/ui/badge",
        id: "badge",
        link: "/plans",
        type: "instance",
      },
    ],
    id: "root",
    padding: 24,
    type: "page",
  };

  it("writes a page as its component, with the imports its instances need", () => {
    expect(
      toCode(page, ds, { component: "PricingPage" })
    ).toBe(`import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";

export default function PricingPage() {
  return (
    <div className="flex flex-col min-h-screen p-6">
      <div className="flex flex-col gap-4 self-stretch">
        <h1>Pricing</h1>
        <Button disabled size={2} variant="outline">Start</Button>
        {/* Hidden: Draft */}
      </div>
      <a href="/plans">
        <Badge />
      </a>
    </div>
  );
}`);
  });

  it("writes a node below the page as its markup alone", () => {
    const hero = page.children[0] as DesignNode;
    expect(
      toCode(hero, ds, { parent: "row" })
    ).toBe(`import { Button } from "@acme/ui/button";

<div className="flex flex-col gap-4 flex-1 min-w-0">
  <h1>Pricing</h1>
  <Button disabled size={2} variant="outline">Start</Button>
  {/* Hidden: Draft */}
</div>`);
  });

  it("puts attributes on lines of their own when the tag is too long", () => {
    const node: DesignNode = {
      color: "$color-muted-foreground",
      id: "p",
      role: "paragraph",
      size: "$text-lg",
      text: "A {braced} line\nand another",
      tracking: "$tracking-wide",
      type: "text",
      width: 480,
    };
    expect(toCode(node, ds)).toBe(`<p
  className="w-120 text-lg tracking-wide text-muted-foreground whitespace-pre-wrap"
>
  {"A {braced} line\\nand another"}
</p>`);
  });

  it("merges a className prop with the node's utilities", () => {
    const node: DesignNode = {
      component: "Card",
      from: "@acme/ui/card",
      id: "card",
      padding: 8,
      props: { className: "ring-1", "data-x": "y", "weird key": 1 },
      type: "instance",
    };
    expect(toCode(node, ds)).toBe(`import { Card } from "@acme/ui/card";

<Card data-x="y" {...{"weird key":1}} className="ring-1 p-2" />`);
  });

  it("sizes an instance's children by the layout its component was drawn with", () => {
    const node: DesignNode = {
      children: [
        {
          height: "fill",
          id: "body",
          role: "paragraph",
          text: "Hi",
          type: "text",
        },
      ],
      component: "Card",
      from: "@acme/ui/card",
      id: "card",
      type: "instance",
    };
    expect(toCode(node, ds)).toContain(`<p className="h-full">Hi</p>`);
    expect(
      toCode(node, ds, {
        instances: { card: { layout: "column", wrapped: false } },
      })
    ).toContain(`<p className="flex-1 min-h-0">Hi</p>`);
  });

  it("puts the box of a component that keeps its props on a div around it", () => {
    const node: DesignNode = {
      component: "Card",
      from: "@acme/ui/card",
      height: "fill",
      id: "card",
      props: { size: "sm" },
      type: "instance",
    };
    expect(
      toCode(node, ds, {
        instances: { card: { layout: "block", wrapped: true } },
        parent: "column",
      })
    ).toBe(`import { Card } from "@acme/ui/card";

<div className="flex flex-col flex-1 min-h-0">
  <Card size="sm" />
</div>`);
  });
});

describe("pageComponentName", () => {
  it("names a page after its route", () => {
    expect(pageComponentName("/")).toBe("HomePage");
    expect(pageComponentName("/settings/billing")).toBe("SettingsBillingPage");
    expect(pageComponentName("/invoices/:id")).toBe("InvoicesIdPage");
    expect(pageComponentName("/404")).toBe("Page404");
  });
});
