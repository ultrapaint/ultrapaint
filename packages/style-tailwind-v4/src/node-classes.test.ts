import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
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

const CLASS_NAME_RE = /className="([^"]*)"/;

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

  it("writes a detailed system's colour as the utility of its own namespace", () => {
    const node: DesignNode = {
      border: { color: "$border-color-focus", width: 1 },
      color: "$text-color-subtle",
      fill: "$background-color-danger-subtle",
      id: "t",
      role: "paragraph",
      text: "Hi",
      type: "text",
    };
    expect(classesOf(node, ds)).toEqual(
      expect.arrayContaining([
        "border-focus",
        "text-subtle",
        "bg-danger-subtle",
      ])
    );
    // A text colour on a fill is no utility of `bg`: its variable.
    expect(
      classesOf(
        { children: [], fill: "$text-color-subtle", id: "g", type: "group" },
        ds
      )
    ).toEqual(["bg-(--text-color-subtle)"]);
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

describe("a blur behind a box", () => {
  const blurred = (backdropBlur: string | number) =>
    classesOf({ backdropBlur, children: [], id: "bar", type: "row" }, ds);

  it("writes a blur token as Tailwind's step, another token as its variable and a length in brackets", () => {
    expect(blurred("$blur-md")).toContain("backdrop-blur-md");
    expect(blurred("$spacing-gutter")).toContain(
      "backdrop-blur-(--spacing-gutter)"
    );
    expect(blurred(10)).toContain("backdrop-blur-[10px]");
    expect(blurred("0.5rem")).toContain("backdrop-blur-[0.5rem]");
  });

  it("writes no blur as backdrop-blur-none", () => {
    expect(blurred(0)).toContain("backdrop-blur-none");
    expect(blurred("none")).toContain("backdrop-blur-none");
  });
});

describe("a fill in layers", () => {
  const bg = (background: string) => responsive([null, { background }]);

  it("writes a gradient as Tailwind's own utilities, its token stops by name and its positions where they are not the default", () => {
    expect(
      bg(
        "linear-gradient(90deg in oklab, $color-primary, $color-accent 40%, transparent)"
      )
    ).toEqual([
      "bg-linear-90",
      "from-primary",
      "via-accent",
      "via-40%",
      "to-transparent",
    ]);
    expect(
      bg(
        "linear-gradient(to right in oklab, $color-primary 10%, $color-accent), $color-background"
      )
    ).toEqual([
      "bg-linear-to-r",
      "from-primary",
      "from-10%",
      "to-accent",
      "bg-background",
    ]);
    expect(
      bg("radial-gradient(in oklab, $color-glow, transparent 70%)")
    ).toEqual(["bg-radial", "from-glow", "to-transparent", "to-70%"]);
    expect(
      bg("conic-gradient(from -45deg in oklch, $color-a, #ff0000 12.5%)")
    ).toEqual(["-bg-conic-45/oklch", "from-a", "to-[#ff0000]", "to-[12.5%]"]);
    expect(bg("linear-gradient(in oklab, $color-a, $color-b)")).toEqual([
      "bg-linear-to-b",
      "from-a",
      "to-b",
    ]);
  });

  it("gives a gradient that names no colour space the direction CSS mixes it in, as an arbitrary one", () => {
    expect(
      bg("linear-gradient(90deg, transparent, #ec4899, transparent)")
    ).toEqual([
      "bg-linear-[90deg]",
      "from-transparent",
      "via-[#ec4899]",
      "to-transparent",
    ]);
    expect(bg("radial-gradient(circle at top, $color-a, $color-b)")).toEqual([
      "bg-radial-[circle_at_top]",
      "from-a",
      "to-b",
    ]);
    expect(bg("radial-gradient($color-a, $color-b)")).toEqual([
      "bg-radial-[ellipse]",
      "from-a",
      "to-b",
    ]);
  });

  it("writes one arbitrary value where the named utilities cannot say it, its tokens as their variables", () => {
    expect(bg("linear-gradient(90deg, #fff, #eee, #ddd, #ccc)")).toEqual([
      "bg-[linear-gradient(90deg,_#fff,_#eee,_#ddd,_#ccc)]",
    ]);
    expect(
      bg(
        "radial-gradient($color-a, transparent), linear-gradient($color-b 10px, $color-c), $color-d"
      )
    ).toEqual([
      "bg-[radial-gradient(var(--color-a),_transparent),_linear-gradient(var(--color-b)_10px,_var(--color-c))]",
      "bg-d",
    ]);
  });

  it("writes an image as Tailwind's own utilities, centred and not repeated at its fit, over its colour (ADR 0149)", async () => {
    expect(
      bg("url(assets/hero.png) center / cover no-repeat, $color-card")
    ).toEqual([
      "bg-[url(assets/hero.png)]",
      "bg-center",
      "bg-cover",
      "bg-no-repeat",
      "bg-card",
    ]);
    expect(bg("url(assets/hero.png) center / contain no-repeat")).toEqual([
      "bg-[url(assets/hero.png)]",
      "bg-center",
      "bg-contain",
      "bg-no-repeat",
    ]);
    // A space in its path, which Tailwind keeps inside a url(), as the URL says it.
    const fill = bg('url("assets/a b.png") center / 100% 100% no-repeat');
    expect(fill).toEqual([
      "bg-[url(assets/a%20b.png)]",
      "bg-center",
      "bg-size-[100%_100%]",
      "bg-no-repeat",
    ]);
    const rules = await compiledClasses(fill);
    expect(fill.map((cls) => Object.fromEntries(rules.get(cls) ?? []))).toEqual(
      [
        { "background-image": "url(assets/a%20b.png)" },
        { "background-position": "center" },
        { "background-size": "100% 100%" },
        { "background-repeat": "no-repeat" },
      ]
    );
    // A bracket or a quote, which would quote the url() in the class, as the URL says it.
    expect(bg("url('assets/hero(1).png') center / cover no-repeat")).toEqual([
      "bg-[url(assets/hero%281%29.png)]",
      "bg-center",
      "bg-cover",
      "bg-no-repeat",
    ]);
    // Written with nothing after it, an image is CSS's default: its own size, tiled.
    expect(bg("url(assets/tile.png)")).toEqual(["bg-[url(assets/tile.png)]"]);
  });

  it("writes an image among gradients as the background shorthand, which says each layer's fit (ADR 0149)", () => {
    expect(
      bg(
        "linear-gradient(in oklab, $color-scrim, transparent), url(assets/hero.png) center / cover no-repeat, $color-bg"
      )
    ).toEqual([
      "[background:linear-gradient(in_oklab,_var(--color-scrim),_transparent),_url(assets/hero.png)_center_/_cover_no-repeat,_var(--color-bg)]",
    ]);
    // Over a variable, which may hold an image too: the shorthand, a space in the path as %20.
    expect(
      bg('url("assets/a b.png") center / cover no-repeat, var(--under, red)')
    ).toEqual([
      "[background:url(assets/a%20b.png)_center_/_cover_no-repeat,_var(--under,_red)]",
    ]);
  });

  it("writes a fill it cannot read as the background shorthand, which takes an image over a colour", () => {
    expect(
      bg("linear-gradient(red 0% 25%, transparent 25% 50%), $color-bg")
    ).toEqual([
      "[background:linear-gradient(red_0%_25%,_transparent_25%_50%),_var(--color-bg)]",
    ]);
    expect(bg("var(--hero, linear-gradient(red, blue))")).toEqual([
      "[background:var(--hero,_linear-gradient(red,_blue))]",
    ]);
  });

  it("keeps a variable a whole stop may come from in the image, and a variable under images in the shorthand", () => {
    expect(bg("linear-gradient(var(--start, red 25%), blue)")).toEqual([
      "bg-[linear-gradient(var(--start,_red_25%),_blue)]",
    ]);
    expect(
      bg(
        "linear-gradient(red, transparent), var(--under, linear-gradient(green, yellow))"
      )
    ).toEqual([
      "[background:linear-gradient(red,_transparent),_var(--under,_linear-gradient(green,_yellow))]",
    ]);
  });

  it("bounds a shorthand base where a breakpoint's fill takes over, its size and repeat with it", () => {
    expect(
      responsive(
        [
          null,
          {
            background: "linear-gradient(red, blue) 0 0 / 10px 10px no-repeat",
          },
        ],
        [
          "md",
          {
            background:
              "linear-gradient(90deg in oklab, $color-a, transparent), $color-b",
          },
        ]
      )
    ).toEqual([
      "max-md:[background:linear-gradient(red,_blue)_0_0_/_10px_10px_no-repeat]",
      "md:bg-linear-90",
      "md:from-a",
      "md:to-transparent",
      "md:bg-b",
    ]);
  });

  it("writes a token in a gradient's geometry as its variable", () => {
    expect(bg("radial-gradient(circle at $spacing-4 50%, red, blue)")).toEqual([
      "bg-radial-[circle_at_var(--spacing-4)_50%]",
      "from-[red]",
      "to-[blue]",
    ]);
  });

  it("keeps a colour above the bottom one an image, over the bottom one's utility", () => {
    expect(bg("linear-gradient(#ff000080, #ff000080), #0000ff")).toEqual([
      "bg-[linear-gradient(#ff000080,_#ff000080)]",
      "bg-[#0000ff]",
    ]);
  });

  it("places a stop below zero with an arbitrary value, which Tailwind's bare position refuses", () => {
    expect(bg("linear-gradient(in oklab, $color-a -10%, $color-b)")).toEqual([
      "bg-linear-to-b",
      "from-a",
      "from-[-10%]",
      "to-b",
    ]);
  });

  it("writes a token inside a stop's or the bottom's own CSS as its variable", () => {
    expect(
      bg(
        "linear-gradient(in oklab, color-mix(in srgb, $color-primary 50%, transparent), $color-accent), color-mix(in oklab, $color-muted 20%, white)"
      )
    ).toEqual([
      "bg-linear-to-b",
      "from-[color-mix(in_srgb,_var(--color-primary)_50%,_transparent)]",
      "to-accent",
      "bg-[color-mix(in_oklab,_var(--color-muted)_20%,_white)]",
    ]);
  });

  it("bounds a gradient where a breakpoint fills the box with a colour, and a colour where it takes a gradient", () => {
    expect(
      responsive(
        [null, { background: "linear-gradient(in oklab, $color-a, $color-b)" }],
        ["md", { background: "$color-c" }]
      )
    ).toEqual([
      "max-md:bg-linear-to-b",
      "max-md:from-a",
      "max-md:to-b",
      "md:bg-c",
    ]);
    expect(
      responsive(
        [null, { background: "$color-c" }],
        ["md", { background: "linear-gradient(in oklab, $color-a, $color-b)" }]
      )
    ).toEqual(["max-md:bg-c", "md:bg-linear-to-b", "md:from-a", "md:to-b"]);
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

describe("a box's shadows", () => {
  const shadow = (boxShadow: string) => responsive([null, { boxShadow }]);

  it("writes several shadows as one arbitrary value in their order, each token as its variable", async () => {
    const [cls = ""] = shadow(
      "$shadow-md, inset 0 0 0 1px rgba(0,0,0,.1), $elevation-ring"
    );
    expect(cls).toBe(
      "shadow-[var(--shadow-md),_inset_0_0_0_1px_rgba(0,0,0,.1),_var(--elevation-ring)]"
    );
    const rules = await compiledClasses([cls]);
    expect(rules.get(cls)?.get("--tw-shadow")).toBe(
      "var(--shadow-md), inset 0 0 0 1px var(--tw-shadow-color, rgba(0,0,0,.1)), var(--elevation-ring)"
    );
  });

  it("writes one shadow as it always has, a token by its name", () => {
    expect(shadow("$shadow-md")).toEqual(["shadow-md"]);
    expect(shadow("$shadow-md,")).toEqual(["shadow-md"]);
    expect(shadow("$elevation-ring")).toEqual(["shadow-(--elevation-ring)"]);
    expect(shadow("inset 0 1px 0 #fff")).toEqual([
      "shadow-[inset_0_1px_0_#fff]",
    ]);
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
            from: SYSTEM_FROM,
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
        from: SYSTEM_FROM,
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
    ).toBe(`import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

  it("writes a page's own minimum as the screen's height at least (ADR 0075)", () => {
    const tall: DesignNode = {
      children: [],
      id: "root",
      minHeight: 1024,
      type: "page",
    };
    expect(toCode(tall, ds, { component: "TallPage" })).toContain(
      'className="flex flex-col min-h-[max(1024px,_100vh)]"'
    );
  });

  it("writes a node below the page as its markup alone", () => {
    const hero = page.children[0] as DesignNode;
    expect(
      toCode(hero, ds, { parent: "row" })
    ).toBe(`import { Button } from "@/components/ui/button";

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
      from: SYSTEM_FROM,
      id: "card",
      padding: 8,
      props: { className: "ring-1", "data-x": "y", "weird key": 1 },
      type: "instance",
    };
    expect(toCode(node, ds)).toBe(`import { Card } from "@/components/ui/card";

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
      from: SYSTEM_FROM,
      id: "card",
      type: "instance",
    };
    expect(toCode(node, ds)).toContain(`<p className="h-full">Hi</p>`);
    expect(
      toCode(node, ds, {
        catalogue: [
          {
            category: "Layout",
            importFrom: SYSTEM_FROM,
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

  it("writes a blur behind a box from its breakpoint up", () => {
    const node: DesignNode = {
      at: { md: { backdropBlur: "$blur-lg" } },
      children: [],
      id: "sheet",
      type: "column",
    };
    expect(write(node)).toBe(
      `<div className="flex flex-col md:backdrop-blur-lg" />`
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

describe("a text's case, text wrap and lines", () => {
  const breakpoints = [
    { min: 768, name: "md" },
    { min: 1024, name: "lg" },
  ];
  /** A text's classes, as its code writes them. */
  const text = (fields: Partial<Extract<DesignNode, { type: "text" }>>) => {
    const code = writeCode(
      { id: "t", role: "paragraph", text: "A name", type: "text", ...fields },
      tailwindClasses(ds),
      { breakpoints, designSystem: ds }
    );
    const match: RegExpExecArray | null = CLASS_NAME_RE.exec(code);
    return match?.[1];
  };

  it("writes Tailwind's named classes", () => {
    expect(text({ case: "upper" })).toBe("uppercase");
    expect(text({ case: "lower" })).toBe("lowercase");
    expect(text({ textWrap: "balance" })).toBe("text-balance");
    expect(text({ textWrap: "none" })).toBe("text-nowrap");
    expect(text({ lines: 1 })).toBe("truncate");
    expect(text({ lines: 2 })).toBe("line-clamp-2");
    expect(text({ lines: 12 })).toBe("line-clamp-12");
  });

  it("writes them at a breakpoint with its prefix", () => {
    expect(text({ at: { md: { case: "upper", lines: 1 } } })).toBe(
      "md:uppercase md:truncate"
    );
  });

  it("writes each default at a breakpoint as what takes the base's away", () => {
    expect(text({ at: { md: { case: "none" } }, case: "upper" })).toBe(
      "uppercase md:normal-case"
    );
    expect(
      text({ at: { md: { textWrap: "wrap" } }, textWrap: "balance" })
    ).toBe("text-balance md:text-wrap");
    expect(text({ at: { md: { lines: "all" } }, lines: 1 })).toBe(
      "truncate md:line-clamp-none md:whitespace-normal md:text-clip"
    );
    expect(text({ at: { md: { lines: "all" } }, lines: 2 })).toBe(
      "line-clamp-2 md:line-clamp-none md:whitespace-normal md:text-clip"
    );
  });

  it("keeps a hidden text hidden over its clamp", () => {
    expect(text({ at: { md: { hidden: true } }, lines: 2 })).toBe(
      "max-md:line-clamp-2 md:hidden"
    );
    expect(
      text({ at: { md: { hidden: false } }, hidden: true, lines: 2 })
    ).toBe("hidden md:line-clamp-2");
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
