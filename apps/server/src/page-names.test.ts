import { describe, expect, it } from "vitest";
import {
  designTargetNamed,
  type NamedPage,
  pageNamed,
  pageTargetNamed,
} from "./services/page-names.ts";

const page = (
  canvas: string,
  path: string,
  more: Partial<NamedPage> = {}
): NamedPage => {
  const id = canvas ? `${canvas}/${path}` : path;
  return { canvas, file: `designs/${id}`, id, path, ...more };
};

const home = page("", "home.page.json", { route: "/" });
const bold = page("", "home@bold.page.json", { route: "/", variant: "bold" });
const empty = page("", "orders@empty.page.json", { state: "empty" });
const orders = page("", "orders.page.json", { route: "/orders" });
const sketch = page("", "sketch.page.json");
const pricing = page("marketing", "home.page.json", { route: "/" });

const found = (pages: readonly NamedPage[], name: string, canvas?: string) => {
  const named = pageNamed(pages, name, canvas);
  return named._tag === "Found" ? named.page.id : named;
};

describe("pageNamed", () => {
  const pages = [home, bold, empty, orders, sketch];

  it("names by URL the base page, not a variant's", () => {
    expect(found(pages, "/")).toBe(home.id);
    expect(found(pages, "/orders/")).toBe(orders.id);
  });

  it("names any page by its id, file or path, a variant's and a state's too", () => {
    expect(found(pages, bold.id)).toBe(bold.id);
    expect(found(pages, empty.file)).toBe(empty.id);
    expect(found(pages, "sketch.page.json")).toBe(sketch.id);
  });

  it("names by nothing the only page there is", () => {
    expect(found([sketch], "")).toBe(sketch.id);
    expect(found(pages, "")).toEqual({ _tag: "Missing", route: null });
  });

  it("says a miss was read as a URL", () => {
    expect(found(pages, "/nowhere/")).toEqual({
      _tag: "Missing",
      route: "/nowhere",
    });
    expect(found(pages, "nowhere.page.json")).toEqual({
      _tag: "Missing",
      route: null,
    });
  });

  it("is ambiguous across canvases unless one is named", () => {
    const both = [...pages, pricing];
    expect(found(both, "/")).toEqual({
      _tag: "Ambiguous",
      canvases: ["", "marketing"],
    });
    expect(found(both, "home.page.json")).toMatchObject({ _tag: "Ambiguous" });
    expect(found(both, "/", "marketing")).toBe(pricing.id);
    expect(found(both, "/", "")).toBe(home.id);
    expect(found(both, "/orders", "marketing")).toEqual({
      _tag: "Missing",
      route: "/orders",
    });
    expect(found([sketch, pricing], "", "marketing")).toBe(pricing.id);
  });
});

describe("designTargetNamed", () => {
  const marketing = page("marketing", "pricing.page.json", {
    route: "/pricing",
  });
  const pages = [home, bold, orders, sketch, marketing];
  const components = [{ name: "Button" }, { name: "Card" }];

  const target = (name: string, canvas?: string) => {
    const named = designTargetNamed(pages, components, name, canvas);
    switch (named._tag) {
      case "Page":
        return named.nodeId === undefined
          ? named.page.id
          : `${named.page.id} ${named.nodeId}`;
      case "Component":
        return `component ${named.component.name}`;
      default:
        return named;
    }
  };

  it.each([
    ["Button", "component Button"],
    [" component:Card ", "component Card"],
    ["component:Nope", { _tag: "Missing", kind: "component", route: null }],
    ["Nope", { _tag: "Missing", kind: "component", route: null }],
    ["/", home.id],
    ["/orders", orders.id],
    ["orders.page.json", orders.id],
    ["designs/sketch.page.json", sketch.id],
    ["home@bold.page.json", bold.id],
    ["/pricing", marketing.id],
    ["marketing:/pricing", marketing.id],
    ["marketing:pricing.page.json", marketing.id],
    [":/pricing", { _tag: "Missing", kind: "page", route: null }],
    ["/orders#c_8", `${orders.id} c_8`],
    ["marketing:/pricing#c_9", `${marketing.id} c_9`],
    ["sketch.page.json#c_1", `${sketch.id} c_1`],
    ["canvas#c_1", { _tag: "Missing", kind: "page", route: null }],
    ["/nowhere", { _tag: "Missing", kind: "page", route: "/nowhere" }],
    ["/nowhere#c_1", { _tag: "Missing", kind: "page", route: "/nowhere" }],
    ["nowhere.page.json", { _tag: "Missing", kind: "page", route: null }],
    ["", { _tag: "Missing", kind: "page", route: null }],
  ] as const)("names %j as %j", (name, expected) => {
    expect(target(name)).toEqual(expected);
  });

  it("narrows a page to the canvas given, which a canvas the name says gives way to", () => {
    expect(target("/pricing", "")).toEqual({
      _tag: "Missing",
      kind: "page",
      route: "/pricing",
    });
    expect(target("marketing:/pricing", "")).toEqual({
      _tag: "Missing",
      kind: "page",
      route: "/pricing",
    });
    expect(target("Button", "marketing")).toBe("component Button");
    expect(target("", "marketing")).toBe(marketing.id);
  });

  it("is ambiguous across canvases unless one is named", () => {
    const both = [
      ...pages,
      page("marketing", "home.page.json", { route: "/" }),
    ];
    expect(designTargetNamed(both, components, "/")).toEqual({
      _tag: "Ambiguous",
      canvases: ["", "marketing"],
    });
    expect(designTargetNamed(both, components, "/#c_1")).toMatchObject({
      _tag: "Ambiguous",
    });
    expect(designTargetNamed(both, components, "marketing:/")).toMatchObject({
      _tag: "Page",
      page: { canvas: "marketing" },
    });
  });
});

describe("pageTargetNamed", () => {
  const marketing = page("marketing", "pricing.page.json", {
    route: "/pricing",
  });
  const pages = [home, orders, sketch, marketing];

  /** A page as a tool names it: a bare name is a page's too, never a component's. */
  it.each([
    ["marketing:/pricing", { _tag: "Page", page: marketing }],
    ["marketing:pricing.page.json", { _tag: "Page", page: marketing }],
    ["orders.page.json", { _tag: "Page", page: orders }],
    [orders.id, { _tag: "Page", page: orders }],
    ["/orders#c_8", { _tag: "Page", nodeId: "c_8", page: orders }],
    ["canvas#c_1", { _tag: "Loose", nodeId: "c_1" }],
    ["Button", { _tag: "Missing", route: null }],
    ["marketing:/nowhere", { _tag: "Missing", route: "/nowhere" }],
  ] as const)("names %j as %j", (name, expected) => {
    expect(pageTargetNamed(pages, name)).toEqual(expected);
  });
});
