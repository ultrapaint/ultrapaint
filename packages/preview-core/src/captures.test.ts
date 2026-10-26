// @vitest-environment happy-dom
import type { DesignNode } from "@ultrapaint/contracts/document";
import { beforeEach, describe, expect, it } from "vitest";
import { buildStatic, captureInstances, dropCaptures } from "./captures.ts";

const card = (title: string, child: DesignNode): DesignNode => ({
  children: [
    {
      children: [child],
      component: "Card",
      from: "@acme/ui/card",
      id: "card",
      props: { tone: "quiet" },
      text: undefined,
      type: "instance",
    },
    {
      component: "Button",
      from: "@acme/ui/button",
      id: "go",
      text: title,
      type: "instance",
    },
  ],
  id: "root",
  type: "page",
});

/** What the components drew for `card("Go", …)`, as the live render leaves it. */
const drawn = () => {
  const root = document.createElement("div");
  root.innerHTML = `<div data-ed-node="root">
    <section data-ed-node="card" class="card quiet"><h2>Card</h2><div class="body"><p data-ed-node="t1">Hello</p></div></section>
    <button data-ed-node="go" class="btn"><span>Go</span></button>
  </div>`;
  return root;
};

const build = (page: DesignNode) =>
  buildStatic({
    assetUrl: (src) => src,
    designSystem: null,
    mode: "page",
    pageHeight: "100%",
    root: page,
    specs: undefined,
  });

beforeEach(() => {
  dropCaptures();
});

describe("a page drawn from captures", () => {
  it("is drawn from what its instances drew, with other children and another text", () => {
    const text = (id: string, said: string): DesignNode => ({
      id,
      role: "paragraph",
      text: said,
      type: "text",
    });
    captureInstances(card("Go", text("t1", "Hello")), null, drawn());
    const fragment = build(card("Send", text("t2", "Bonjour")));
    const root = document.createElement("div");
    root.append(fragment as DocumentFragment);
    const section = root.querySelector('[data-ed-node="card"]');
    expect(section?.className).toBe("card quiet");
    expect(section?.querySelector("h2")?.textContent).toBe("Card");
    expect(section?.querySelector('[data-ed-node="t2"]')?.textContent).toBe(
      "Bonjour"
    );
    expect(root.querySelector('[data-ed-node="go"] span')?.textContent).toBe(
      "Send"
    );
  });

  it("is not drawn while an instance of it has no capture", () => {
    const page: DesignNode = {
      children: [
        { component: "Dialog", from: "@acme/ui/dialog", id: "d", type: "instance" },
      ],
      id: "root",
      type: "page",
    };
    expect(build(page)).toBeNull();
  });
});
