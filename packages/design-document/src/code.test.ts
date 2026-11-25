import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import { APP_FROM, SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type {
  AppComponentFile,
  PartStyles,
} from "@ultrapaint/contracts/components";
import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import type { ClassWriter } from "@ultrapaint/contracts/node-style";
import { describe, expect, it } from "vitest";
import {
  componentsImportBase,
  type Markup,
  pageComponentName,
  SLOT_PLACEHOLDER,
  type SystemDrawing,
  toCode,
  toHtml,
} from "./code.ts";
import type { ComponentLook } from "./component-look.ts";

/** A style system that writes each declaration as a class, to see what it is given. */
const writer: ClassWriter = {
  classes: (styles) =>
    styles.flatMap(({ breakpoint, declarations }) =>
      Object.entries(declarations).map(
        ([property, value]) =>
          `${breakpoint === null ? "" : `${breakpoint}/`}${property}:${value}`
      )
    ),
};

describe("toCode", () => {
  it("writes the markup and the imports, and leaves the classes to the style system", () => {
    const page: PageNode = {
      children: [
        {
          children: [
            {
              id: "t",
              role: "heading",
              text: "Hi",
              type: "text",
              width: "fill",
            },
          ],
          id: "row",
          type: "row",
          width: "fill",
        },
        {
          component: "Button",
          from: SYSTEM_FROM,
          id: "b",
          padding: 8,
          text: "Go",
          type: "instance",
        },
      ],
      id: "root",
      type: "page",
    };
    expect(toCode(page, writer, { component: "HomePage" })).toBe(
      `import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="display:flex flexDirection:column minHeight:100vh">
      <div className="display:flex flexDirection:row alignSelf:stretch">
        <h1 className="flexBasis:0% flexGrow:1 flexShrink:1 minWidth:0">Hi</h1>
      </div>
      <Button className="padding:8">Go</Button>
    </div>
  );
}`
    );
  });

  it("sizes an instance's child against the slot it fills, a look's direction and an app component's slots", () => {
    const fill = (id: string, slot?: string): DesignNode =>
      ({
        height: "fill",
        id,
        role: "paragraph",
        text: id,
        type: "text",
        ...(slot !== undefined && { slot }),
      }) as DesignNode;
    const catalogue: Catalogue = [
      {
        category: "Layout",
        importFrom: "@ultrapaint/system",
        name: "Card",
        props: [],
        slots: [
          { label: "Card", name: "root" },
          {
            holds: "default",
            label: "Body",
            layout: "column",
            layoutIn: { "size=lg": "row" },
            name: "card-content",
          },
          { holds: "nodes", label: "Footer", name: "card-footer" },
        ],
        variants: { size: ["md", "lg"] },
      },
      {
        category: "App",
        importFrom: "#app",
        name: "Plan",
        props: [],
        slots: [
          { holds: "default", label: "body", layout: "column", name: "body" },
        ],
        variants: {},
      },
    ];
    const card = (props?: Record<string, string>): DesignNode => ({
      children: [fill("body"), fill("foot", "card-footer")],
      component: "Card",
      from: "@ultrapaint/system",
      id: "card",
      type: "instance",
      ...(props && { props }),
    });
    const code = toCode(card(), writer, { catalogue });
    const GROWS = "flexBasis:0% flexGrow:1 flexShrink:1 minHeight:0";
    expect(code).toContain(`<p className="${GROWS}">body</p>`);
    expect(code).toContain(`<p className="height:100%">foot</p>`);
    // In its large variant the look lays the body out as a row, which stretches it across.
    expect(toCode(card({ size: "lg" }), writer, { catalogue })).toContain(
      `<p className="alignSelf:stretch">body</p>`
    );
    const plan: DesignNode = {
      children: [fill("mine")],
      component: "Plan",
      from: "#app",
      id: "plan",
      type: "instance",
    };
    expect(toCode(plan, writer, { catalogue })).toContain(
      `<p className="${GROWS}">mine</p>`
    );
  });
});

describe("an app component's instance overrides (ADR 0114)", () => {
  const none: ClassWriter = { classes: () => [] };
  const files: Record<string, AppComponentFile> = {
    AppShell: {
      name: "AppShell",
      origin: "app",
      properties: [],
      slots: [],
      tree: {
        children: [
          {
            children: [
              {
                component: "NavItem",
                from: "#app",
                id: "i_9k2m1x",
                name: "Nav",
                type: "instance",
              },
            ],
            id: "c_0c99hh",
            name: "Sidebar",
            type: "column",
          },
        ],
        id: "r_root",
        type: "row",
      },
      version: 1,
    },
    NavItem: {
      name: "NavItem",
      origin: "app",
      properties: [],
      slots: [],
      tree: {
        children: [
          {
            id: "t_l4bel",
            name: "Label",
            role: "paragraph",
            text: "Home",
            type: "text",
          },
        ],
        id: "r_item",
        type: "row",
      },
      version: 1,
    },
  };
  const shell: DesignNode = {
    component: "AppShell",
    from: "#app",
    id: "shell",
    overrides: {
      c_0c99hh: { at: { md: { hidden: true } }, fill: "#000" },
      i_9k2m1x: { props: { label: "Home" } },
      "i_9k2m1x/t_l4bel": { color: "red" },
    },
    props: { title: "Orders" },
    type: "instance",
  };
  const code = () =>
    toCode(shell, none, {
      breakpoints: [{ min: 768, name: "md" }],
      fileOf: (name) => files[name],
    });

  it("are written as props named for each layer's name and the field", () => {
    expect(code()).toContain('sidebarFill="#000"');
    expect(code()).toContain('navLabelColor="red"');
  });

  it("set a nested instance's prop as a prop named for its layer", () => {
    expect(code()).toContain('navLabel="Home"');
  });

  it("are written beside the instance's own props", () => {
    expect(code()).toContain('title="Orders"');
  });

  it("keep apart two layers of one name, by the second's id", () => {
    const twice = toCode(
      {
        ...shell,
        overrides: { a_one: { fill: "red" }, b_two: { fill: "blue" } },
        props: {},
      } as DesignNode,
      none,
      {
        fileOf: () =>
          ({
            ...files.AppShell,
            tree: {
              children: [
                { children: [], id: "a_one", name: "Panel", type: "column" },
                { children: [], id: "b_two", name: "Panel", type: "column" },
              ],
              id: "r_root",
              type: "row",
            },
          }) as AppComponentFile,
      }
    );
    expect(twice).toContain('panelFill="red"');
    expect(twice).toContain('panelBTwoFill="blue"');
  });

  it("keep a layer's field apart from its nested instance's prop of the same name", () => {
    const both = toCode(
      {
        ...shell,
        overrides: { i_9k2m1x: { props: { width: 120 }, width: 240 } },
        props: {},
      } as DesignNode,
      none,
      { fileOf: (name) => files[name] }
    );
    expect(both).toContain("navWidth={240}");
    expect(both).toContain("navI9k2m1xWidth={120}");
  });

  it("never take a name the instance's props have, at its base or at a breakpoint", () => {
    const crowded = toCode(
      {
        ...shell,
        at: { md: { props: { panelBFill: "x" } } },
        overrides: { a_one: { fill: "red" }, b: { fill: "blue" } },
        props: { panelFill: "y" },
      } as DesignNode,
      none,
      {
        breakpoints: [{ min: 768, name: "md" }],
        fileOf: () =>
          ({
            ...files.AppShell,
            tree: {
              children: [
                { children: [], id: "a_one", name: "Panel", type: "column" },
                { children: [], id: "b", name: "Panel", type: "column" },
              ],
              id: "r_root",
              type: "row",
            },
          }) as AppComponentFile,
      }
    );
    expect(crowded).toContain('panelFill="y"');
    expect(crowded).toContain('panelAOneFill="red"');
    expect(crowded).toContain('panelBFill2="blue"');
  });

  it("write a nested instance's prop named `at` as any other", () => {
    expect(
      toCode(
        {
          ...shell,
          overrides: { i_9k2m1x: { props: { at: "noon" } } },
          props: {},
        } as DesignNode,
        none,
        { fileOf: (name) => files[name] }
      )
    ).toContain('navAt="noon"');
  });

  it("set at a breakpoint are written for that breakpoint", () => {
    expect(code()).toContain("sidebarHidden");
  });
});

describe("a tinted image", () => {
  it("is written as its file masking its tint, the tint taking the fill's classes", () => {
    const fills: ClassWriter = {
      classes: ([base]) => [`bg-${base?.declarations.background ?? "none"}`],
    };
    const icon: DesignNode = {
      alt: "Check",
      id: "i",
      src: "assets/icons/check.svg",
      tint: "$color-muted",
      type: "image",
    };
    expect(toCode(icon, fills, { parent: "row" })).toBe(
      `<span
  aria-label="Check"
  className="bg-$color-muted"
  role="img"
  style={{"maskImage":"url(\\"assets/icons/check.svg\\")","WebkitMaskImage":"url(\\"assets/icons/check.svg\\")"}}
/>`
    );
  });
});

describe("a link", () => {
  const nav: DesignNode = {
    children: [
      {
        id: "t",
        link: "pricing.page.json",
        role: "paragraph",
        text: "Pricing",
        type: "text",
      },
    ],
    id: "nav",
    link: "draft.page.json",
    type: "row",
  };
  const none: ClassWriter = { classes: () => [] };

  it("is written with the href its caller gives it, on a text's anchor and on a container that is one", () => {
    const hrefOf = (link: string) =>
      link === "pricing.page.json" ? "/pricing" : link;
    expect(toCode(nav, none, { hrefOf })).toBe(
      `<a href="draft.page.json">
  <a href="/pricing">
    <p>Pricing</p>
  </a>
</a>`
    );
  });

  it("is written as it is when nothing says where it leads", () => {
    expect(toCode(nav, none)).toContain('href="pricing.page.json"');
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

describe("breakpoints", () => {
  const breakpoints = [
    { min: 768, name: "md" },
    { min: 1024, name: "lg" },
  ];

  it("gives the style system a node's declarations at each breakpoint the tree sets", () => {
    const node: DesignNode = {
      at: { lg: { gap: 32 } },
      children: [
        { at: { md: { width: 200 } }, children: [], id: "a", type: "group" },
      ],
      gap: 16,
      id: "s",
      type: "column",
    };
    expect(toCode(node, writer, { breakpoints })).toBe(
      `<div
  className="display:flex flexDirection:column gap:16 md/display:flex md/flexDirection:column md/gap:16 lg/display:flex lg/flexDirection:column lg/gap:32"
>
  <div className="md/width:200 lg/width:200" />
</div>`
    );
  });

  it("hides an element written once per run of widths outside its run", () => {
    const node: DesignNode = {
      at: { md: { text: "Wide" } },
      id: "t",
      role: "paragraph",
      text: "Narrow",
      type: "text",
    };
    expect(toCode(node, writer, { breakpoints })).toBe(
      `<p className="md/display:none">Narrow</p>
<p className="display:none">Wide</p>`
    );
  });
});

describe("an app component in the Code tab", () => {
  it("names a property as one prop, at a breakpoint that changes it too", () => {
    const plan: DesignNode = {
      at: { md: { props: { "show badge": true } } },
      component: "Plan",
      from: APP_FROM,
      id: "p",
      props: { "plan name": "Pro", "show badge": false },
      type: "instance",
    };
    expect(
      toCode(plan, writer, { breakpoints: [{ min: 768, name: "md" }] })
    ).toBe(
      `import { Plan } from "@/components/plan";

<Plan planName="Pro" showBadge={false} className="md/display:none" />
<Plan planName="Pro" showBadge className="display:none" />`
    );
  });
});

describe("a system component in the Code tab", () => {
  const catalogue: Catalogue = [
    {
      category: "Overlay",
      importFrom: SYSTEM_FROM,
      name: "Dialog",
      props: [],
      slots: [
        { label: "Dialog", name: "root" },
        { holds: "nodes", label: "Trigger", layout: "row", name: "trigger" },
        {
          holds: "default",
          label: "Content",
          layout: "column",
          name: "dialog-content",
        },
        {
          holds: "nodes",
          label: "Footer",
          layout: "row",
          name: "dialog-footer",
        },
      ],
      variants: {},
    },
  ];
  const dialog: DesignNode = {
    children: [
      {
        component: "Button",
        from: SYSTEM_FROM,
        id: "open",
        slot: "trigger",
        text: "Delete",
        type: "instance",
      },
      { id: "p", role: "paragraph", text: "For good.", type: "text" },
      {
        id: "lost",
        role: "paragraph",
        slot: "nowhere",
        text: "Gone with it.",
        type: "text",
      },
      {
        component: "Button",
        from: SYSTEM_FROM,
        id: "cancel",
        props: { variant: "outline" },
        slot: "dialog-footer",
        text: "Cancel",
        type: "instance",
      },
      {
        component: "Button",
        from: SYSTEM_FROM,
        id: "ok",
        slot: "dialog-footer",
        text: "Delete",
        type: "instance",
      },
    ],
    component: "Dialog",
    from: SYSTEM_FROM,
    id: "d",
    props: { title: "Delete it?" },
    type: "instance",
  };

  it("is the application's component, its slots that component's parts, as the canvas fills them", () => {
    const none: ClassWriter = { classes: () => [] };
    // A child naming a slot the component lacks is in the default one, as on the canvas.
    expect(toCode(dialog, none, { catalogue })).toBe(
      `import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

<Dialog title="Delete it?">
  <DialogTrigger>
    <Button>Delete</Button>
  </DialogTrigger>
  <p>For good.</p>
  <p>Gone with it.</p>
  <DialogFooter>
    <Button variant="outline">Cancel</Button>
    <Button>Delete</Button>
  </DialogFooter>
</Dialog>`
    );
    expect(
      toCode(dialog, none, { catalogue, componentsFrom: "@/ui" }).split("\n")[0]
    ).toBe('import { Button } from "@/ui/button";');
  });

  it("is imported from the first component directory's ui/, `src/` as the `@/` alias", () => {
    expect(componentsImportBase({ libraryDirs: [] })).toBe("@/components/ui");
    expect(
      componentsImportBase({
        libraryDirs: ["apps/web/src/components"],
        resolveFrom: "apps/web",
      })
    ).toBe("@/components/ui");
    expect(componentsImportBase({ libraryDirs: ["src/lib"] })).toBe("@/lib/ui");
    expect(componentsImportBase({ libraryDirs: ["packages/ui/src"] })).toBe(
      "packages/ui/src/ui"
    );
  });
});

describe("toHtml", () => {
  const breakpoints = [{ min: 768, name: "md" }];
  /** The classes of every element, in the order they are written: `class` or `className`. */
  const classesIn = (code: string) =>
    [...code.matchAll(/class(?:Name)?="([^"]*)"/g)].map((m) => m[1]);

  it("writes a row with a text and an image as HTML elements, with the classes its JSX has and no imports", () => {
    const row: DesignNode = {
      children: [
        {
          id: "t",
          role: "heading",
          text: "Cats & <dogs>",
          type: "text",
          width: "fill",
        },
        { alt: 'A "cat"', id: "i", src: "/cat.png", type: "image", width: 40 },
      ],
      gap: 8,
      id: "row",
      type: "row",
    };
    const html = toHtml(row, writer);
    expect(html).toBe(
      `<div class="display:flex flexDirection:row gap:8">
  <h1 class="flexBasis:0% flexGrow:1 flexShrink:1 minWidth:0">
    Cats &amp; &lt;dogs&gt;
  </h1>
  <img
    alt="A &quot;cat&quot;"
    class="width:40 flexShrink:0 objectFit:cover"
    src="/cat.png"
  >
</div>`
    );
    expect(classesIn(html)).toEqual(classesIn(toCode(row, writer)));
  });

  it("writes an app component's instance as its layers as the instance draws them, its overrides applied", () => {
    const files: Record<string, AppComponentFile> = {
      Plan: {
        name: "Plan",
        origin: "app",
        properties: [
          {
            default: "Basic",
            kind: "text",
            name: "plan name",
            targets: [{ node: "t_name" }],
          },
        ],
        slots: [],
        tree: {
          children: [
            {
              id: "t_name",
              name: "Name",
              role: "paragraph",
              text: "Basic",
              type: "text",
            },
            {
              component: "Price",
              from: APP_FROM,
              id: "i_price",
              name: "Price",
              type: "instance",
            },
          ],
          id: "r_plan",
          padding: 16,
          type: "column",
        },
        version: 1,
      },
      Price: {
        name: "Price",
        origin: "app",
        properties: [],
        slots: [],
        tree: {
          children: [
            { id: "t_sum", role: "paragraph", text: "$9", type: "text" },
          ],
          id: "r_price",
          type: "row",
        },
        version: 1,
      },
    } as unknown as Record<string, AppComponentFile>;
    const plan: DesignNode = {
      component: "Plan",
      from: APP_FROM,
      id: "p",
      overrides: {
        "i_price/t_sum": { color: "red", text: "$29" },
        t_name: { at: { md: { hidden: true } } },
      },
      props: { "plan name": "Pro" },
      type: "instance",
      width: 240,
    };
    expect(
      toHtml(plan, writer, { breakpoints, fileOf: (name) => files[name] })
    ).toBe(
      `<div
  class="display:flex flexDirection:column width:240 padding:16 md/display:flex md/flexDirection:column md/width:240 md/padding:16"
>
  <p class="md/display:none">Pro</p>
  <div
    class="display:flex flexDirection:row md/display:flex md/flexDirection:row"
  >
    <p class="color:red md/color:red">$29</p>
  </div>
</div>`
    );
  });

  describe("a system component's instance", () => {
    const catalogue: Catalogue = [
      {
        category: "Inputs",
        importFrom: SYSTEM_FROM,
        name: "Button",
        props: [],
        slots: [
          { holds: "default", label: "Button", layout: "row", name: "root" },
          { label: "Spinner", name: "button-spinner" },
        ],
        variants: { variant: ["primary", "outline"] },
      },
      {
        category: "Overlay",
        importFrom: SYSTEM_FROM,
        name: "Toast",
        props: [],
        slots: [{ label: "Toast", name: "root" }],
        variants: {},
      },
    ];
    const button = (
      parts: PartStyles,
      variants: ComponentLook["variants"] = {}
    ): ComponentLook => ({
      base: parts,
      component: "Button",
      defaults: { variant: "primary" },
      parts: ["root", "button-spinner"],
      states: { hover: { root: { fill: "$color-accent" } } },
      variants,
    });
    /** What the view renders at rest, as a fake of the server's rendering. */
    const markup: SystemDrawing["markup"] = ({ props = {} }, slots) => [
      {
        attributes: [
          ["type", "button"],
          ["data-ed-node", ""],
          ["data-slot", "root"],
          ["data-variant", String(props.variant ?? "primary")],
          ["data-system", "button"],
        ],
        children: [
          {
            attributes: [
              ["aria-hidden", "true"],
              ["data-slot", "button-spinner"],
            ],
            children: [],
            kind: "element",
            tag: "span",
          },
          ...slots.map(
            (name): Markup => ({
              attributes: [["name", name]],
              children: [],
              kind: "element",
              tag: SLOT_PLACEHOLDER,
            })
          ),
        ],
        kind: "element",
        tag: "button",
      },
    ];
    const drawings: Record<string, SystemDrawing> = {
      Button: {
        content: {},
        looks: [
          // The default look, then the project's, which the canvas draws over it.
          button(
            {
              "button-spinner": { width: 12 },
              root: { fill: "$color-primary", radius: 6 },
            },
            { variant: { outline: { root: { border: { width: 1 } } } } }
          ),
          {
            ...button(
              { root: { padding: { left: 12, right: 12 } } },
              { variant: { outline: { root: { fill: "transparent" } } } }
            ),
            hidden: ["button-spinner"],
          },
        ],
        markup,
      },
      Toast: { content: {}, looks: [], markup: () => [] },
    };
    const options = {
      breakpoints,
      catalogue,
      systemDrawing: (name: string) => drawings[name],
    };

    it("is written as the elements its view renders at rest, each part with its look's classes in the instance's variant", () => {
      const go = (props?: Record<string, string>): DesignNode => ({
        component: "Button",
        from: SYSTEM_FROM,
        id: "b",
        margin: 4,
        text: "Go",
        type: "instance",
        ...(props && { props }),
      });
      // The project's look over the default's; the node's own style over both; a part the look
      // leaves out is left out; a state is not drawn at rest; the editor's marks go.
      expect(toHtml(go({ variant: "outline" }), writer, options)).toBe(
        `<button
  class="background:transparent borderRadius:6 borderWidth:1 borderStyle:solid paddingRight:12 paddingLeft:12 margin:4"
  type="button"
  data-slot="root"
  data-variant="outline"
>
  Go
</button>`
      );
      // An instance that does not set an axis is in its default member.
      expect(toHtml(go(), writer, options)).toContain(
        'class="background:$color-primary borderRadius:6 paddingRight:12 paddingLeft:12 margin:4"'
      );
    });

    it("holds its children in its slots, against the slot's layout", () => {
      const go: DesignNode = {
        children: [
          {
            height: "fill",
            id: "t",
            role: "paragraph",
            text: "Go",
            type: "text",
          },
        ],
        component: "Button",
        from: SYSTEM_FROM,
        id: "b",
        link: "next.page.json",
        type: "instance",
      };
      const none: ClassWriter = {
        classes: (styles) =>
          styles[0]?.declarations.alignSelf === "stretch" ? ["stretch"] : [],
      };
      expect(
        toHtml(go, none, { ...options, hrefOf: () => "/next" })
      ).toBe(`<a href="/next">
  <button type="button" data-slot="root" data-variant="primary">
    <p class="stretch">Go</p>
  </button>
</a>`);
    });

    it("that its view draws nothing for at rest is left out, and says so", () => {
      const toast: DesignNode = {
        component: "Toast",
        from: SYSTEM_FROM,
        id: "t",
        name: "Saved",
        props: { open: true },
        type: "instance",
      };
      expect(toHtml(toast, writer, options)).toBe(
        "<!-- Saved draws nothing at rest: it shows when open. -->"
      );
    });
  });

  it("writes a node's values at the breakpoints as the classes' breakpoint variants, as the JSX has them", () => {
    const node: DesignNode = {
      at: { md: { gap: 32 } },
      children: [
        {
          at: { md: { text: "Wide" } },
          id: "t",
          role: "paragraph",
          text: "Narrow",
          type: "text",
        },
      ],
      gap: 16,
      id: "s",
      type: "column",
    };
    const html = toHtml(node, writer, { breakpoints });
    expect(html).toBe(
      `<div
  class="display:flex flexDirection:column gap:16 md/display:flex md/flexDirection:column md/gap:32"
>
  <p class="md/display:none">Narrow</p>
  <p class="display:none">Wide</p>
</div>`
    );
    expect(classesIn(html)).toEqual(
      classesIn(toCode(node, writer, { breakpoints }))
    );
  });

  it("writes a link as the href its caller gives it", () => {
    const nav: DesignNode = {
      children: [
        {
          id: "t",
          link: "pricing.page.json",
          role: "paragraph",
          text: "Pricing",
          type: "text",
        },
      ],
      id: "nav",
      link: "draft.page.json",
      type: "row",
    };
    const none: ClassWriter = { classes: () => [] };
    expect(
      toHtml(nav, none, {
        hrefOf: (link) => (link === "pricing.page.json" ? "/pricing" : link),
      })
    ).toBe(`<a href="draft.page.json">
  <a href="/pricing">
    <p>Pricing</p>
  </a>
</a>`);
  });

  it("leaves out a node hidden at every breakpoint, as the JSX does", () => {
    const node: DesignNode = {
      children: [
        {
          hidden: true,
          id: "h",
          name: "Old price",
          role: "paragraph",
          text: "$5",
          type: "text",
        },
        { id: "t", role: "paragraph", text: "$9", type: "text" },
      ],
      id: "s",
      type: "row",
    };
    const none: ClassWriter = { classes: () => [] };
    expect(toHtml(node, none)).toBe(`<div>
  <!-- Hidden: Old price -->
  <p>$9</p>
</div>`);
  });
});

describe("an instance's prop named as an attribute of the markup", () => {
  it("keeps its own name beside the classes", () => {
    const badge: DesignNode = {
      component: "Badge",
      from: SYSTEM_FROM,
      id: "b",
      padding: 4,
      props: { class: "pill" },
      text: "New",
      type: "instance",
    };
    expect(toCode(badge, writer, { imports: false })).toBe(
      '<Badge class="pill" className="padding:4">New</Badge>'
    );
  });
});
