import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  type ClassWriter,
  pageComponentName,
  responsiveClasses,
  toCode,
} from "./code.ts";

/** A style system that writes each node's type and its parent's layout, to see where they go. */
const writer: ClassWriter = {
  classes: (node, parent) => [`is-${node.type}`, `in-${parent}`],
  wrapper: (classes) => ["around", ...classes],
};

describe("toCode", () => {
  it("writes the markup and the imports, and leaves the classes to the style system", () => {
    const page: PageNode = {
      children: [
        {
          children: [{ id: "t", role: "heading", text: "Hi", type: "text" }],
          id: "row",
          type: "row",
        },
        {
          component: "Button",
          from: "@acme/ui/button",
          id: "b",
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
    <div className="is-page in-free">
      <div className="is-row in-column">
        <h1 className="is-text in-row">Hi</h1>
      </div>
      <Button className="is-instance in-column">Go</Button>
    </div>
  );
}`
    );
  });

  it("puts the classes of a component that keeps its props on the element around it", () => {
    const node: DesignNode = {
      component: "Card",
      from: "@acme/ui/card",
      id: "card",
      type: "instance",
    };
    expect(
      toCode(node, writer, {
        instances: { card: { layout: "block", wrapped: true } },
        parent: "column",
      })
    ).toBe(`import { Card } from "@acme/ui/card";

<div className="around is-instance in-column">
  <Card />
</div>`);
  });
});

describe("a tinted image", () => {
  it("is written as its file masking its tint, the tint taking the fill's classes", () => {
    const fills: ClassWriter = {
      classes: (node) => [`bg-${node.fill ?? "none"}`],
      wrapper: (classes) => classes,
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

describe("responsiveClasses", () => {
  it("lets a class of a breakpoint take over from one of its group, and bounds the rest", () => {
    expect(
      responsiveClasses(
        [null, "md", "lg"],
        [
          ["gap-4", "self-start", "w-fit"],
          ["gap-6", "self-stretch"],
          ["gap-4", "w-50"],
        ]
      )
    ).toEqual([
      "gap-4",
      // Taken over at md, and the one that took over stops at lg: so does it.
      "max-lg:self-start",
      "max-md:w-fit",
      "md:gap-6",
      "md:max-lg:self-stretch",
      "lg:gap-4",
      "lg:w-50",
    ]);
  });
});
