// @vitest-environment happy-dom
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import type {
  ComponentRegistry,
  Mounted,
} from "@ultrapaint/framework-api/browser";
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

const FROM = "@acme/ui";
const registry: ComponentRegistry = {
  [FROM]: () => Promise.resolve({ Broken, Card, Stubborn }),
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

/** Draws a node and waits until it is on the screen and the instances are reported. */
const draw = async (root: DesignNode) => {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  const reports: Record<string, InstanceDrawn> = {};
  const navigated: string[] = [];
  const rendered = new Promise<void>((resolve) => {
    mounted = renderToCanvas(
      {
        assetUrl: (src) => src,
        components: registry,
        navigate: (route) => navigated.push(route),
        onRendered: () => resolve(),
        providers: undefined,
        reportError: () => undefined,
        reportInstances: (instances) => Object.assign(reports, instances),
      },
      canvas
    );
    mounted.render({ designSystem: null, mode: "page", renderId: 1, root });
  });
  await rendered;
  await frame();
  await frame();
  const at = (id: string) =>
    canvas.querySelector(`[data-ed-node="${id}"]`) as HTMLElement | null;
  return { at, canvas, navigated, reports };
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
