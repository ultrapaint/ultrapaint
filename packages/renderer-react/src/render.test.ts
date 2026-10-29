// @vitest-environment happy-dom
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import { SYSTEM_FROM } from "@ultrapaint/contracts/spec-names";
import { type ComponentSpec, emptySpec } from "@ultrapaint/contracts/specs";
import type {
  Mounted,
  RenderRequest,
} from "@ultrapaint/framework-api/browser";
import { renderSetup } from "@ultrapaint/preview-core/render-setup";
import { adoptedSheets } from "@ultrapaint/preview-core/styles";
import { afterEach, describe, expect, it } from "vitest";
import { renderToCanvas } from "./render.ts";

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
  extra: Pick<RenderRequest, "specs" | "styles"> = {}
) => {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  const reports: Record<string, InstanceDrawn> = {};
  const navigated: string[] = [];
  const waiting = new Map<number, () => void>();
  const rendered = new Promise<void>((resolve) => {
    const setup = renderSetup(
      { assets: "/api/asset" },
      {
        canvas: "",
        events: {
          instances: (instances) => Object.assign(reports, instances),
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

  it("tells the editor how its default slot lays its children out", async () => {
    const { reports } = await draw(
      column([instance("card", "Card"), instance("go", "Button")])
    );
    expect(reports.card).toEqual({ layout: "column", wrapped: false });
    expect(reports.go).toEqual({ layout: "row", wrapped: false });
  });

  it("stands in for an instance of the repository's, and for a name no system component has", async () => {
    const { at } = await draw(
      column([
        instance("old", "Button", { from: "@/components/ui/button" }),
        instance("typo", "Buton"),
      ])
    );
    expect(at("old")?.textContent).toContain("component of the repository's");
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
      ...emptySpec("Card", SYSTEM_FROM),
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
