import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import type { Declarations } from "@ultrapaint/contracts/node-style";
import { toCode as writeCode } from "@ultrapaint/design-document/code";
import {
  declarationsOf,
  makeStyleContext,
  type ParentLayout,
} from "@ultrapaint/design-document/css";
import { describe, expect, it } from "vitest";
import { tailwindClasses } from "./node-classes.ts";
import { compiledClasses } from "./testing.ts";

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

/** A node as code with Tailwind's classes. */
const toCode = (
  node: DesignNode,
  designSystem: typeof ds,
  options?: Parameters<typeof writeCode>[2]
) =>
  writeCode(node, tailwindClasses(designSystem), { designSystem, ...options });

/** The classes of a node at every width, its parent laying it out as `parent`. */
const classesOf = (
  node: DesignNode,
  designSystem: typeof ds,
  parent: ParentLayout = "free"
) =>
  tailwindClasses(designSystem).classes([
    {
      breakpoint: null,
      declarations: declarationsOf(
        node,
        makeStyleContext(designSystem, parent)
      ),
    },
  ]);

/** The classes of declarations given at the base, then at each breakpoint. */
const responsive = (...levels: (readonly [string | null, Declarations])[]) =>
  tailwindClasses(ds).classes(
    levels.map(([breakpoint, declarations]) => ({ breakpoint, declarations }))
  );

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

describe("a colour's keyword", () => {
  it("is written for the CSS keyword and for Tailwind's own value of it", () => {
    expect(
      responsive([
        null,
        {
          background: "#000",
          borderColor: "white",
          color: "#FFF",
        },
      ])
    ).toEqual(["bg-black", "border-white", "text-white"]);
    expect(responsive([null, { background: "#ffffff" }])).toEqual([
      "bg-[#ffffff]",
    ]);
  });
});

const UPPER_RE = /[A-Z]/g;

describe("a length's keyword", () => {
  it("is written on a utility Tailwind takes it on, and the value in brackets elsewhere", () => {
    expect(responsive([null, { gap: "100%" }])).toEqual(["gap-[100%]"]);
    expect(responsive([null, { padding: "auto", width: "100%" }])).toEqual([
      "p-[auto]",
      "w-full",
    ]);
  });

  it("gives every length a class Tailwind compiles to it", async () => {
    const properties = [
      "gap",
      "width",
      "height",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
      "padding",
      "paddingTop",
      "margin",
      "marginLeft",
    ];
    const values = [
      "100%",
      "100vw",
      "100vh",
      "100dvw",
      "100dvh",
      "auto",
      "fit-content",
      "min-content",
      "max-content",
      "none",
    ];
    const written = properties.flatMap((property) =>
      values.map((value) => ({
        classes: responsive([null, { [property]: value }]),
        property: property.replace(UPPER_RE, (c) => `-${c.toLowerCase()}`),
        value,
      }))
    );
    const rules = await compiledClasses(written.flatMap((w) => w.classes));
    const wrong = written
      .filter(
        ({ classes: [cls = "", ...more], property, value }) =>
          more.length > 0 || rules.get(cls)?.get(property) !== value
      )
      .map((w) => `${w.property}: ${w.value} as ${w.classes.join(" ")}`);
    expect(wrong).toEqual([]);
  });
});

describe("a border's width", () => {
  it("is Tailwind's utility for whole pixels, and an arbitrary value otherwise", () => {
    const widths = [1.5, 3].map((width) =>
      classesOf({ border: { width }, children: [], id: "g", type: "group" }, ds)
    );
    expect(widths).toEqual([["border-[1.5px]"], ["border-3"]]);
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

  it("sizes an instance's children by the layout of the slot they fill", () => {
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
        catalogue: [
          {
            category: "Layout",
            importFrom: "@acme/ui/card",
            name: "Card",
            props: [],
            slots: [
              {
                holds: "default",
                label: "Card",
                layout: "column",
                name: "root",
              },
            ],
            variants: {},
          },
        ],
      })
    ).toContain(`<p className="flex-1 min-h-0">Hi</p>`);
  });
});

describe("toCode's names and text", () => {
  it("gives two default exports of the same name a name each, and none a named import's", () => {
    const row: DesignNode = {
      children: [
        {
          component: "default",
          from: "@acme/ui/button",
          id: "a",
          type: "instance",
        },
        {
          component: "default",
          from: "@beta/ui/button",
          id: "b",
          type: "instance",
        },
        { component: "Button", from: "@gamma/ui", id: "c", type: "instance" },
      ],
      id: "row",
      type: "row",
    };
    expect(toCode(row, ds)).toBe(`import Button2 from "@acme/ui/button";
import Button3 from "@beta/ui/button";
import { Button } from "@gamma/ui";

<div className="flex">
  <Button2 />
  <Button3 />
  <Button />
</div>`);
  });

  it("leaves the page's own name to the page", () => {
    const settings: DesignNode = {
      children: [
        {
          component: "default",
          from: "@/components/settings-page",
          id: "a",
          type: "instance",
        },
        {
          component: "SettingsPage",
          from: "@acme/ui",
          id: "b",
          type: "instance",
        },
      ],
      id: "root",
      type: "page",
    };
    const code = toCode(settings, ds, { component: "SettingsPage" });
    expect(code).toContain(
      'import SettingsPage3 from "@/components/settings-page";'
    );
    expect(code).toContain(
      'import { SettingsPage as SettingsPage2 } from "@acme/ui";'
    );
    expect(code).toContain("export default function SettingsPage() {");
    expect(code).toContain("<SettingsPage3 />");
    expect(code).toContain("<SettingsPage2 />");
  });

  it("gives a component imported by name from two modules a name each", () => {
    const row: DesignNode = {
      children: [
        { component: "Card", from: "@acme/ui/card", id: "a", type: "instance" },
        { component: "Card", from: "@beta/ui", id: "b", type: "instance" },
        { component: "Card2", from: "@gamma/ui", id: "c", type: "instance" },
      ],
      id: "row",
      type: "row",
    };
    expect(toCode(row, ds)).toBe(`import { Card } from "@acme/ui/card";
import { Card as Card3 } from "@beta/ui";
import { Card2 } from "@gamma/ui";

<div className="flex">
  <Card />
  <Card3 />
  <Card2 />
</div>`);
  });

  it("writes text JSX would read otherwise as a string", () => {
    const text = (value: string): DesignNode => ({
      id: "t",
      role: "paragraph",
      text: value,
      type: "text",
    });
    expect(toCode(text("Tom & Jerry"), ds)).toBe("<p>Tom & Jerry</p>");
    expect(toCode(text("Fish &amp; chips"), ds)).toBe(
      `<p>{"Fish &amp; chips"}</p>`
    );
    expect(toCode(text("a < b"), ds)).toBe(`<p>{"a < b"}</p>`);
    expect(toCode(text("{x}"), ds)).toBe(`<p>{"{x}"}</p>`);
    const image: DesignNode = {
      alt: "R&amp;D",
      id: "i",
      src: "/a.png",
      type: "image",
    };
    expect(toCode(image, ds)).toContain(`alt={"R&amp;D"}`);
  });
});

describe("breakpoints", () => {
  const breakpoints = [
    { min: 768, name: "md" },
    { min: 1024, name: "lg" },
  ];
  const write = (node: DesignNode) =>
    writeCode(node, tailwindClasses(ds), { breakpoints, designSystem: ds });

  it("writes what a node sets at a breakpoint with its prefix, mobile-first", () => {
    const node: DesignNode = {
      at: { lg: { gap: 32 }, md: { gap: 24, type: "row", wrap: true } },
      children: [],
      gap: 16,
      id: "s",
      type: "column",
    };
    expect(write(node)).toBe(
      `<div className="flex max-md:flex-col gap-4 md:flex-wrap md:gap-6 lg:gap-8" />`
    );
  });

  it("hides a node below a breakpoint, and writes a text that differs once per run of widths", () => {
    const node: DesignNode = {
      children: [
        {
          at: { md: { hidden: false } },
          hidden: true,
          id: "nav",
          role: "paragraph",
          text: "Links",
          type: "text",
        },
        {
          at: { lg: { text: "Open the menu" } },
          id: "menu",
          role: "paragraph",
          size: "$text-lg",
          text: "Menu",
          type: "text",
        },
      ],
      id: "s",
      type: "row",
    };
    expect(write(node)).toBe(`<div className="flex">
  <p className="max-md:hidden">Links</p>
  <p className="text-lg lg:hidden">Menu</p>
  <p className="text-lg max-lg:hidden">Open the menu</p>
</div>`);
  });

  it("moves a node among its siblings from a breakpoint on with order", () => {
    const node: DesignNode = {
      at: { md: { order: -1 } },
      id: "t",
      role: "paragraph",
      text: "First on a wide screen",
      type: "text",
    };
    expect(write(node)).toBe(
      `<p className="md:-order-1">First on a wide screen</p>`
    );
  });
});

describe("a breakpoint's classes", () => {
  it("take over from those below that set what they set, and bound the rest", () => {
    expect(
      responsive(
        [null, { alignSelf: "flex-start", gap: 16, width: "fit-content" }],
        ["md", { alignSelf: "stretch", gap: 24 }],
        ["lg", { gap: 16, width: 200 }]
      )
    ).toEqual([
      // Taken over at md, and the one that took over stops at lg: so does it.
      "max-lg:self-start",
      "gap-4",
      "max-md:w-fit",
      "md:max-lg:self-stretch",
      "md:gap-6",
      "lg:gap-4",
      "lg:w-50",
    ]);
  });

  it("are taken over by a shorthand that sets them all", () => {
    expect(
      responsive(
        [null, { flexShrink: "0", paddingLeft: 12, paddingRight: 8 }],
        [
          "md",
          {
            flexBasis: "0%",
            flexGrow: "1",
            flexShrink: "1",
            paddingLeft: 8,
            paddingRight: 8,
          },
        ]
      )
    ).toEqual(["shrink-0", "pl-3", "pr-2", "md:flex-1", "md:px-2"]);
  });
});

describe("what the canvas draws", () => {
  it("keeps a node's own minimum where a fill would set none", () => {
    const node: DesignNode = {
      children: [],
      id: "g",
      minWidth: 26,
      type: "group",
      width: "fill",
    };
    expect(classesOf(node, ds, "row")).toEqual(["flex-1", "min-w-6.5"]);
  });

  it("writes a tinted image as a block masked by its file", () => {
    const icon: DesignNode = {
      height: 16,
      id: "i",
      src: "assets/icons/check.svg",
      tint: "$color-muted",
      type: "image",
      width: 16,
    };
    expect(classesOf(icon, ds)).toEqual([
      "block",
      "max-w-full",
      "w-4",
      "h-4",
      "bg-muted",
      "mask-center",
      "mask-no-repeat",
      "mask-contain",
    ]);
    expect(classesOf({ ...icon, fit: "fill" }, ds)).toContain(
      "[mask-size:100%_100%]"
    );
  });

  it("tells Tailwind what a value is where it could read another", () => {
    const node: DesignNode = {
      font: "$heading",
      id: "t",
      maxWidth: "100vh",
      role: "paragraph",
      size: "$spacing-4",
      text: "Hi",
      type: "text",
      weight: "bold",
    };
    expect(classesOf(node, ds)).toEqual([
      "max-w-[100vh]",
      "font-(family-name:--heading)",
      "text-(length:--spacing-4)",
      "font-[weight:bold]",
      "leading-(--spacing-4--line-height)",
    ]);
  });
});
