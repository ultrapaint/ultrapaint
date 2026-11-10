// @vitest-environment happy-dom

import {
  APP_FROM,
  type AppComponentFile,
  type ComponentFile,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { emptySystemComponent } from "@ultrapaint/contracts/testing/components";
import type { Mounted } from "@ultrapaint/preview-core/preview";
import { renderSetup } from "@ultrapaint/preview-core/render-setup";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToCanvas } from "./render.ts";

// The catalogue as it is, with its makings counted.
vi.mock(import("@ultrapaint/system-components/catalogue"), async (original) => {
  const actual = await original();
  return { ...actual, catalogueOf: vi.fn(actual.catalogueOf) };
});

const instance = (
  id: string,
  component: string,
  fields: Partial<Extract<DesignNode, { type: "instance" }>> = {}
): DesignNode => ({
  component,
  from: SYSTEM_FROM,
  id,
  type: "instance",
  ...fields,
});

const text = (id: string, fields: Partial<DesignNode> = {}): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text", ...fields }) as DesignNode;

const column = (children: DesignNode[]): DesignNode => ({
  children,
  height: 600,
  id: "root",
  type: "column",
});

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

/**
 * Draws a node with the setup a frame of the editor's page gives its renderer, and waits until
 * it is on the screen and the instances are reported.
 */
const draw = async (
  root: DesignNode,
  extra: {
    readonly at?: string;
    readonly components?: readonly ComponentFile[];
  } = {}
) => {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  const navigated: string[] = [];
  const waiting = new Map<number, () => void>();
  const rendered = new Promise<void>((resolve) => {
    const setup = renderSetup(
      { assets: "/api/asset" },
      {
        canvas: "",
        events: {
          navigateTo: (route) => navigated.push(route),
        },
      },
      {
        frame: {
          container: canvas,
          host: canvas,
          interactive: () => false,
          onInteractive: () => () => undefined,
        },
        rendered: (id) => {
          waiting.get(id)?.();
          resolve();
        },
      }
    );
    mounted = renderToCanvas(setup, canvas);
    mounted.render({
      ...(extra.at !== undefined && { at: extra.at }),
      components: extra.components ?? [],
      designSystem: null,
      mode: "page",
      renderId: 1,
      root,
    });
  });
  await rendered;
  await frame();
  await frame();
  const at = (id: string) =>
    canvas.querySelector(`[data-ed-node="${id}"]`) as HTMLElement | null;
  /** Draws the next document over this one, and waits for it the same way. */
  const redraw = async (next: DesignNode) => {
    // The render is a transition: wait until it is the one on the screen.
    const done = new Promise<void>((resolve) => waiting.set(2, resolve));
    mounted?.render({
      components: extra.components ?? [],
      designSystem: null,
      mode: "page",
      renderId: 2,
      root: next,
    });
    await done;
  };
  return { at, canvas, navigated, redraw };
};

describe("a system component", () => {
  it("is drawn with the node's id, marks and box on the element that is the instance", async () => {
    const { at } = await draw(
      column([
        instance("go", "Button", {
          props: { variant: "outline" },
          text: "Go",
          width: 200,
        }),
      ])
    );
    const button = at("go");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("data-variant")).toBe("outline");
    expect(button?.textContent).toBe("Go");
    expect(button?.style.width).toBe("200px");
  });

  it("puts each child in the slot it names, the rest in its default slot", async () => {
    const { canvas } = await draw(
      column([
        instance("card", "Card", {
          children: [
            text("body"),
            instance("ok", "Button", { slot: "card-footer", text: "OK" }),
          ],
          props: { title: "Plan" },
        }),
      ])
    );
    expect(
      canvas.querySelector('[data-slot="card-content"] [data-ed-node="body"]')
    ).not.toBeNull();
    expect(
      canvas.querySelector('[data-slot="card-footer"] [data-ed-node="ok"]')
    ).not.toBeNull();
    expect(canvas.querySelector('[data-slot="card-title"]')?.textContent).toBe(
      "Plan"
    );
  });

  it("lays a child out as the slot it fills does, in the look's direction", async () => {
    const card = instance("card", "Card", {
      children: [text("body", { height: "fill" })],
    });
    const plain = await draw(column([card]));
    // The card's body is a column: a child that fills its height grows along it.
    expect(plain.at("body")?.style.flexGrow).toBe("1");
    plain.canvas.remove();
    const look = {
      ...emptySystemComponent("Card"),
      base: { "card-content": { direction: "row" as const } },
    };
    const turned = await draw(column([card]), { components: [look] });
    // A look that lays it out as a row stretches the child across instead.
    expect(turned.at("body")?.style.flexGrow).toBe("");
    expect(turned.at("body")?.style.alignSelf).toBe("stretch");
  });

  it("stands in for a name no system component has", async () => {
    const { at } = await draw(column([instance("typo", "Buton")]));
    expect(at("typo")?.textContent).toContain(
      "not one of the system components"
    );
  });

  it("follows its link", async () => {
    const { at, navigated } = await draw(
      column([instance("go", "Button", { link: "/next", text: "Go" })])
    );
    at("go")?.click();
    expect(navigated).toEqual(["/next"]);
  });
});

describe("the design's stylesheet and the system components' looks (ADRs 0028, 0041)", () => {
  it("marks every instance with its component and its variant props", async () => {
    const { at } = await draw(
      column([
        instance("card", "Card", { props: { size: "lg", variant: "outline" } }),
      ])
    );
    const card = at("card");
    expect(card?.getAttribute("data-ed-c")).toBe("Card");
    expect(card?.getAttribute("data-ed-v")).toBe("size:lg variant:outline");
  });
});

describe("a system component's look beyond its style (ADR 0041)", () => {
  it("fills a slot the instance gives nothing with the look's content, not the page's", async () => {
    const look = {
      ...emptySystemComponent("Card"),
      content: {
        "card-footer": [text("c-note", { text: "Billed yearly" })],
      },
    };
    const { canvas } = await draw(
      column([
        instance("plain", "Card", { props: { title: "Plan" } }),
        instance("own", "Card", {
          children: [instance("ok", "Button", { slot: "card-footer" })],
        }),
      ]),
      { components: [look] }
    );
    const footers = canvas.querySelectorAll('[data-slot="card-footer"]');
    expect(footers).toHaveLength(2);
    expect(footers[0]?.textContent).toBe("Billed yearly");
    expect(
      footers[0]?.querySelector('[data-ed-app-node="c-note"]')
    ).not.toBeNull();
    expect(footers[1]?.querySelector('[data-ed-node="ok"]')).not.toBeNull();
  });

  it("draws a menu's items from the look's template, each with its label and picture", async () => {
    const look = {
      ...emptySystemComponent("Menu"),
      item: {
        image: "i-pic",
        label: "i-label",
        tree: {
          children: [
            { id: "i-pic", src: "assets/x.svg", type: "image" as const },
            text("i-label"),
          ],
          id: "i-row",
          type: "row" as const,
        },
      },
    };
    const { canvas } = await draw(
      column([
        instance("menu", "Menu", {
          props: {
            items: [{ image: "assets/me.png", label: "Profile" }, "Sign out"],
            open: true,
          },
          text: "Open",
        }),
      ]),
      { components: [look] }
    );
    const items = [...canvas.querySelectorAll('[data-slot="menu-item"]')];
    expect(items.map((i) => i.textContent)).toEqual(["Profile", "Sign out"]);
    const pictures = items.map((i) =>
      i.querySelector('[data-ed-app-node="i-pic"]')
    );
    expect(pictures[0]?.getAttribute("src")).toContain("assets%2Fme.png");
    expect((pictures[1] as HTMLElement | null)?.style.display).toBe("none");
  });
});

describe("an app component (ADR 0041)", () => {
  const promo: AppComponentFile = {
    name: "Promo",
    origin: "app",
    properties: [
      {
        default: "Title",
        kind: "text",
        name: "title",
        targets: [{ node: "d-title" }],
      },
      {
        default: true,
        kind: "boolean",
        name: "with body",
        targets: [{ node: "d-body" }],
      },
      {
        default: "plain",
        kind: "choice",
        members: ["plain", "loud"],
        name: "tone",
      },
      {
        default: "Buy",
        kind: "text",
        name: "action",
        targets: [{ node: "d-go" }],
      },
    ],
    slots: [{ default: true, name: "extra", node: "d-extra" }],
    tree: {
      children: [
        {
          at: { lg: { size: 40 }, md: { size: 24 }, "tone=loud": { size: 32 } },
          id: "d-title",
          role: "heading",
          text: "Title",
          type: "text",
        },
        { id: "d-body", role: "paragraph", text: "Body", type: "text" },
        {
          component: "Button",
          from: SYSTEM_FROM,
          id: "d-go",
          text: "Go",
          type: "instance",
        },
        {
          children: [
            { id: "d-none", role: "paragraph", text: "Nothing", type: "text" },
          ],
          id: "d-extra",
          type: "column",
        },
      ],
      id: "d-root",
      type: "column",
    },
    version: 1,
  };
  const placed = (fields: Partial<Extract<DesignNode, { type: "instance" }>>) =>
    instance("promo", "Promo", { from: APP_FROM, ...fields });

  it("draws its tree with the instance's properties, only its instance selectable", async () => {
    const { at, canvas } = await draw(
      column([
        placed({
          props: { action: "Order", title: "Spring sale", "with body": false },
        }),
      ]),
      { components: [promo] }
    );
    const drawn = at("promo");
    expect(drawn?.getAttribute("data-ed-c")).toBe("Promo");
    expect(at("d-title")).toBeNull();
    const node = (id: string) =>
      canvas.querySelector(`[data-ed-app-node="${id}"]`) as HTMLElement | null;
    expect(node("d-title")?.textContent).toBe("Spring sale");
    expect(node("d-body")?.style.display).toBe("none");
    expect(node("d-go")?.textContent).toBe("Order");
    expect(node("d-none")?.textContent).toBe("Nothing");
  });

  it("lays a choice's overrides over its nodes, and puts the instance's children in its slots", async () => {
    const { at, canvas } = await draw(
      column([
        placed({
          children: [text("mine")],
          props: { tone: "loud" },
        }),
      ]),
      { components: [promo] }
    );
    const title = canvas.querySelector(
      '[data-ed-app-node="d-title"]'
    ) as HTMLElement | null;
    expect(title?.style.fontSize).toBe("32px");
    // The page's own node is the page's: selectable, in the slot in place of what it held.
    expect(
      canvas.querySelector('[data-ed-app-node="d-extra"] [data-ed-node="mine"]')
    ).not.toBeNull();
    expect(at("mine")).not.toBeNull();
    expect(canvas.querySelector('[data-ed-app-node="d-none"]')).toBeNull();
  });

  it("draws its tree at the page's breakpoint, over the choice's overrides", async () => {
    const title = async (at: string | undefined, tone: string) => {
      const { canvas } = await draw(column([placed({ props: { tone } })]), {
        components: [promo],
        ...(at !== undefined && { at }),
      });
      const size = (
        canvas.querySelector(
          '[data-ed-app-node="d-title"]'
        ) as HTMLElement | null
      )?.style.fontSize;
      mounted?.unmount();
      mounted = null;
      document.body.innerHTML = "";
      return size;
    };
    expect(await title(undefined, "plain")).toBe("");
    expect(await title("md", "plain")).toBe("24px");
    expect(await title("lg", "plain")).toBe("40px");
    expect(await title("md", "loud")).toBe("24px");
  });

  it("draws one nested in another, and refuses one drawn inside itself", async () => {
    const outer: AppComponentFile = {
      name: "Outer",
      origin: "app",
      properties: [],
      slots: [],
      tree: {
        children: [
          {
            component: "Promo",
            from: APP_FROM,
            id: "o-promo",
            props: { title: "Inside" },
            type: "instance",
          },
          { component: "Outer", from: APP_FROM, id: "o-me", type: "instance" },
        ],
        id: "o-root",
        type: "row",
      },
      version: 1,
    };
    const { canvas } = await draw(
      column([instance("outer", "Outer", { from: APP_FROM })]),
      { components: [promo, outer] }
    );
    expect(
      canvas.querySelector('[data-ed-app-node="d-title"]')?.textContent
    ).toBe("Inside");
    expect(
      canvas.querySelector('[data-ed-app-node="o-me"]')?.textContent
    ).toContain("drawn inside itself");
  });
});

describe("the look's components", () => {
  it("are made a catalogue of once, however many frames draw with them", async () => {
    const components = [emptySystemComponent("Button")];
    const first = await draw(column([instance("a", "Button")]), { components });
    const frameA = mounted;
    const second = await draw(column([instance("b", "Button")]), {
      components,
    });
    expect(first.at("a")?.tagName).toBe("BUTTON");
    expect(second.at("b")?.tagName).toBe("BUTTON");
    frameA?.unmount();
    expect(
      vi
        .mocked(catalogueOf)
        .mock.calls.filter(([files]) => files === components)
    ).toHaveLength(1);
  });
});
