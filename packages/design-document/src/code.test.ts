import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { type ClassWriter, pageComponentName, toCode } from "./code.ts";

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

describe("pageComponentName", () => {
  it("names a page after its route", () => {
    expect(pageComponentName("/")).toBe("HomePage");
    expect(pageComponentName("/settings/billing")).toBe("SettingsBillingPage");
    expect(pageComponentName("/invoices/:id")).toBe("InvoicesIdPage");
    expect(pageComponentName("/404")).toBe("Page404");
  });
});
