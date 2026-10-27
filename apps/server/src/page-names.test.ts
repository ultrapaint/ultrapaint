import { describe, expect, it } from "vitest";
import { type NamedPage, pageNamed } from "./services/page-names.ts";

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
