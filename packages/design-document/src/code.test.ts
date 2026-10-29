import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import type { ClassWriter } from "@ultrapaint/contracts/node-style";
import { describe, expect, it } from "vitest";
import { componentsImportBase, pageComponentName, toCode } from "./code.ts";

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
          from: "@acme/ui/button",
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
      `import { Button } from "@acme/ui/button";

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

  it("puts the classes of a component that keeps its props on the column around it", () => {
    const node: DesignNode = {
      component: "Card",
      from: "@acme/ui/card",
      id: "card",
      type: "instance",
      width: 320,
    };
    expect(
      toCode(node, writer, {
        instances: { card: { layout: "block", wrapped: true } },
        parent: "column",
      })
    ).toBe(`import { Card } from "@acme/ui/card";

<div className="display:flex flexDirection:column width:320">
  <Card />
</div>`);
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

describe("a system component in the Code tab", () => {
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

  it("is the application's component, its slots that component's parts", () => {
    const none: ClassWriter = { classes: () => [] };
    expect(toCode(dialog, none)).toBe(
      `import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

<Dialog title="Delete it?">
  <DialogTrigger>
    <Button>Delete</Button>
  </DialogTrigger>
  <p>For good.</p>
  <DialogFooter>
    <Button variant="outline">Cancel</Button>
    <Button>Delete</Button>
  </DialogFooter>
</Dialog>`
    );
    expect(
      toCode(dialog, none, { componentsFrom: "@/ui" }).split("\n")[0]
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
