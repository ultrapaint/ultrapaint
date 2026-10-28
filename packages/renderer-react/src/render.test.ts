// @vitest-environment happy-dom
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import { type ComponentSpec, emptySpec } from "@ultrapaint/contracts/specs";
import type {
  ComponentRegistry,
  Mounted,
  RenderRequest,
} from "@ultrapaint/framework-api/browser";
import { renderSetup } from "@ultrapaint/preview-core/render-setup";
import { adoptedSheets } from "@ultrapaint/preview-core/styles";
import { type CSSProperties, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderToCanvas } from "./render.ts";

interface Props {
  children?: ReactNode;
  style?: CSSProperties;
}

/** A component as design systems write them: its props go on its root element. */
const Card = ({ style, ...props }: Props) =>
  createElement("div", {
    "data-slot": "card",
    ...props,
    style: { display: "flex", flexDirection: "column", ...style },
  });

/** One that keeps its props to itself. */
const Stubborn = ({ children }: Props) =>
  createElement("div", { "data-slot": "stubborn" }, children);

const Broken = (): ReactNode => {
  throw new Error("boom");
};

/** One that throws until its prop is fixed. */
const Fragile = ({ fail, ...props }: Props & { fail?: boolean }) => {
  if (fail) {
    throw new Error("bad prop");
  }
  return createElement("div", { ...props, "data-slot": "fragile" });
};

const FROM = "@acme/ui";
const registry: ComponentRegistry = {
  [FROM]: () => Promise.resolve({ Broken, Card, Fragile, Stubborn }),
};

const instance = (
  id: string,
  component: string,
  fields: Partial<Extract<DesignNode, { type: "instance" }>> = {}
): DesignNode => ({ component, from: FROM, id, type: "instance", ...fields });

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
  extra: Pick<RenderRequest, "specs" | "styles"> = {}
) => {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  const reports: Record<string, InstanceDrawn> = {};
  const navigated: string[] = [];
  const waiting = new Map<number, () => void>();
  const rendered = new Promise<void>((resolve) => {
    const setup = renderSetup(
      {
        assets: "/preview/@assets",
        designsRoot: "/preview/@fs/designs",
        providers: undefined,
        theme: "light",
      },
      {
        canvas: "",
        events: {
          instances: (instances) => Object.assign(reports, instances),
          navigateTo: (route) => navigated.push(route),
        },
      },
      {
        components: registry,
        drawing: () => undefined,
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
      designSystem: null,
      mode: "page",
      renderId: 1,
      root,
      ...extra,
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
      designSystem: null,
      mode: "page",
      renderId: 2,
      root: next,
    });
    await done;
  };
  return { at, canvas, navigated, redraw, reports };
};

describe("an instance", () => {
  it("is the component itself, with the node's box on it", async () => {
    const { at, reports } = await draw(
      column([instance("card", "Card", { height: "fill", width: "fill" })])
    );
    const card = at("card");
    expect(card?.dataset.slot).toBe("card");
    expect(card?.hasAttribute("data-ed-wrapper")).toBe(false);
    expect(card?.parentElement?.dataset.edNode).toBe("root");
    expect(card?.style.flexGrow).toBe("1");
    expect(card?.style.alignSelf).toBe("stretch");
    // The component's own style is kept under the node's.
    expect(card?.style.flexDirection).toBe("column");
    expect(reports.card?.wrapped).toBe(false);
  });

  it("merges a style prop under the node's box", async () => {
    const { at } = await draw(
      column([
        instance("card", "Card", {
          props: { style: { color: "red", width: "10px" } },
          width: 200,
        }),
      ])
    );
    expect(at("card")?.style.color).toBe("red");
    expect(at("card")?.style.width).toBe("200px");
  });

  it("is drawn inside a wrapper when the component keeps its props", async () => {
    const { at, reports } = await draw(
      column([
        instance("plain", "Stubborn"),
        instance("sized", "Stubborn", { height: "fill" }),
      ])
    );
    const plain = at("plain");
    expect(plain?.hasAttribute("data-ed-wrapper")).toBe(true);
    expect(plain?.style.display).toBe("contents");
    expect((plain?.firstElementChild as HTMLElement | null)?.dataset.slot).toBe(
      "stubborn"
    );
    const sized = at("sized");
    expect(sized?.style.display).toBe("flex");
    expect(sized?.style.flexGrow).toBe("1");
    expect(reports.plain?.wrapped).toBe(true);
    expect(reports.sized?.wrapped).toBe(true);
  });

  it("sizes its children against the element that holds them", async () => {
    const { at, reports } = await draw(
      column([
        instance("card", "Card", {
          children: [text("body", { height: "fill" })],
          height: "fill",
        }),
      ])
    );
    // The Card is a flex column: a child that fills its height grows, rather than being 100%.
    expect(at("body")?.style.flexGrow).toBe("1");
    expect(at("body")?.style.height).toBe("");
    expect(reports.card?.layout).toBe("column");
  });

  it("sizes the children of a block component as in a group", async () => {
    const { at, reports } = await draw(
      column([
        instance("box", "Stubborn", {
          children: [text("body", { height: "fill" })],
        }),
      ])
    );
    expect(at("body")?.style.height).toBe("100%");
    expect(reports.box?.layout).toBe("block");
  });

  it("keeps the node's id on the error a component throws", async () => {
    const { at } = await draw(column([instance("broken", "Broken")]));
    expect(at("broken")?.textContent).toContain("boom");
  });

  it("draws the component again once the prop that broke it is fixed", async () => {
    const { at, redraw } = await draw(
      column([instance("fragile", "Fragile", { props: { fail: true } })])
    );
    expect(at("fragile")?.textContent).toContain("bad prop");
    await redraw(
      column([instance("fragile", "Fragile", { props: { fail: false } })])
    );
    await frame();
    expect(at("fragile")?.dataset.slot).toBe("fragile");
    expect(at("fragile")?.textContent).not.toContain("bad prop");
  });

  it("stands in for a missing export with the node's box", async () => {
    const { at } = await draw(
      column([instance("gone", "Gone", { width: 80 })])
    );
    expect(at("gone")?.textContent).toContain("has no export Gone");
    expect(at("gone")?.style.width).toBe("80px");
    expect(at("gone")?.hasAttribute("data-ed-wrapper")).toBe(false);
  });

  it("follows its link", async () => {
    const { at, navigated } = await draw(
      column([instance("card", "Card", { link: "/pricing" })])
    );
    at("card")?.click();
    expect(navigated).toEqual(["/pricing"]);
  });
});

describe("the design's stylesheet and specs (ADR 0028, 0029)", () => {
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

  it("gives the frames the tokens' CSS and the specs' as the design's sheet, the last", async () => {
    const spec: ComponentSpec = {
      ...emptySpec("Card", FROM),
      base: { root: { fill: "#ff0000" } },
    };
    await draw(column([instance("card", "Card")]), {
      specs: [spec],
      styles: ":root { --primary: #123456; }",
    });
    const design = Array.from(adoptedSheets().at(-1)?.cssRules ?? [])
      .map((rule) => rule.cssText)
      .join("\n");
    // The document's root is the frame's host.
    expect(design).toContain(":host");
    expect(design).toContain("--primary: #123456");
    expect(design).toContain('[data-ed-c="Card"]');
    expect(design).toContain("background-color: #ff0000");
  });

  it("draws a draft from its tree, only its instance selectable", async () => {
    const draft: ComponentSpec = {
      ...emptySpec("Promo", "#draft"),
      draft: {
        children: [
          { id: "d-title", role: "heading", text: "Title", type: "text" },
          { id: "d-body", role: "paragraph", text: "Body", type: "text" },
        ],
        id: "d-root",
        type: "column",
      },
    };
    const { at, canvas } = await draw(
      column([
        {
          component: "Promo",
          from: "#draft",
          id: "promo",
          text: "Spring sale",
          type: "instance",
        },
      ]),
      { specs: [draft] }
    );
    const promo = at("promo");
    expect(promo?.getAttribute("data-ed-c")).toBe("Promo");
    expect(promo?.textContent).toBe("Spring saleBody");
    expect(at("d-title")).toBeNull();
    expect(
      canvas.querySelector('[data-ed-draft-node="d-body"]')?.textContent
    ).toBe("Body");
  });
});
