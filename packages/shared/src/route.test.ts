import { describe, expect, it } from "vitest";
import {
  basePathOf,
  isSuffixName,
  matchRoute,
  normaliseRoute,
  pageNameOf,
  pageRouteOf,
  routeOf,
  routesOf,
  suffixedPathOf,
  suffixOf,
} from "./route.ts";

describe("a page's name and URL", () => {
  it("names a page after its file", () => {
    expect(pageNameOf("billing-settings.page.json")).toBe("Billing settings");
    expect(pageNameOf("index.page.json")).toBe("Home");
    expect(pageNameOf("settings/index.page.json")).toBe("Settings");
    expect(pageNameOf("invoices/[id].page.json")).toBe("Invoices id");
    expect(pageNameOf("orders@empty.page.json")).toBe("Orders");
  });

  it("serves the URL the canvas gives it, or none", () => {
    const routes = { "pricing.page.json": "/plans" };
    expect(pageRouteOf(routes, "pricing.page.json")).toBe("/plans");
    expect(pageRouteOf(routes, "draft.page.json")).toBeUndefined();
  });

  it("serves the route its path names in a canvas written before URLs were optional", () => {
    expect(pageRouteOf(undefined, "settings/billing.page.json")).toBe(
      "/settings/billing"
    );
    expect(
      routesOf(undefined, ["index.page.json", "pricing.page.json"])
    ).toEqual({ "index.page.json": "/", "pricing.page.json": "/pricing" });
    expect(routesOf({}, ["index.page.json"])).toEqual({});
  });

  it("never matches a page without a URL", () => {
    const pages = [{ id: "draft" }, { id: "home", route: "/" }];
    expect(matchRoute(pages, "/")?.entry.id).toBe("home");
    expect(matchRoute(pages, "/draft")).toBeNull();
  });
});

describe("a page's `@name` file", () => {
  it("reads the name off the file, the page's route from its base's path", () => {
    expect(suffixOf("orders@empty.page.json")).toBe("empty");
    expect(suffixOf("settings/billing@loading-2.page.json")).toBe("loading-2");
    expect(suffixOf("orders.page.json")).toBeNull();
    expect(routeOf("orders@empty.page.json")).toBe("/orders");
    expect(routeOf("index@empty.page.json")).toBe("/");
    expect(routeOf("invoices/[id]@empty.page.json")).toBe("/invoices/:id");
  });

  it("goes between a page's file and its `@name` file", () => {
    expect(basePathOf("settings/billing@empty.page.json")).toBe(
      "settings/billing.page.json"
    );
    expect(suffixedPathOf("settings/billing.page.json", "empty")).toBe(
      "settings/billing@empty.page.json"
    );
    expect(suffixedPathOf("orders@loading.page.json", "empty")).toBe(
      "orders@empty.page.json"
    );
  });

  it("names it with lowercase letters, digits and dashes", () => {
    expect(isSuffixName("empty-2")).toBe(true);
    expect(isSuffixName("Empty")).toBe(false);
    expect(isSuffixName("")).toBe(false);
  });
});

describe("routes derived from page files", () => {
  it("reads a route off the path a page has inside its canvas", () => {
    expect(routeOf("index.tsx")).toBe("/");
    expect(routeOf("pricing.tsx")).toBe("/pricing");
    expect(routeOf("settings/index.tsx")).toBe("/settings");
    expect(routeOf("settings/billing.tsx")).toBe("/settings/billing");
    expect(routeOf("invoices/[id].tsx")).toBe("/invoices/:id");
    expect(routeOf("docs/[...rest].tsx")).toBe("/docs/*");
    expect(routeOf("index.page.json")).toBe("/");
    expect(routeOf("settings/billing.page.json")).toBe("/settings/billing");
    expect(routeOf("invoices/[id].page.json")).toBe("/invoices/:id");
  });

  it("tolerates what a person types", () => {
    expect(normaliseRoute("")).toBe("/");
    expect(normaliseRoute("settings//billing/")).toBe("/settings/billing");
  });
});

describe("matching a route", () => {
  const entries = [
    { route: "/" },
    { route: "/invoices/new" },
    { route: "/invoices/:id" },
    { route: "/docs/*" },
  ];

  it("prefers a static segment over a dynamic one", () => {
    expect(matchRoute(entries, "/invoices/new")?.entry.route).toBe(
      "/invoices/new"
    );
  });

  it("binds the parameters of a dynamic segment", () => {
    expect(matchRoute(entries, "/invoices/42")).toEqual({
      entry: { route: "/invoices/:id" },
      params: { id: "42" },
    });
  });

  it("lets a catch-all take the rest of the path", () => {
    expect(matchRoute(entries, "/docs/guide/intro")).toEqual({
      entry: { route: "/docs/*" },
      params: { rest: "guide/intro" },
    });
  });

  it("prefers a page at the URL itself over a catch-all that also takes it", () => {
    const home = [{ route: "/*" }, { route: "/" }];
    expect(matchRoute(home, "/")?.entry.route).toBe("/");
    expect(matchRoute(home.toReversed(), "/")?.entry.route).toBe("/");
    const docs = [{ route: "/docs/*" }, { route: "/docs" }];
    expect(matchRoute(docs, "/docs")?.entry.route).toBe("/docs");
    expect(matchRoute(docs.toReversed(), "/docs")?.entry.route).toBe("/docs");
    expect(matchRoute(docs, "/docs/guide")?.entry.route).toBe("/docs/*");
  });

  it("lets a catch-all take its own URL when no page is at it", () => {
    expect(matchRoute(entries, "/docs")).toEqual({
      entry: { route: "/docs/*" },
      params: { rest: "" },
    });
  });

  it("prefers a dynamic segment, and the longer pattern, over a catch-all", () => {
    const pages = [
      { route: "/*" },
      { route: "/docs/*" },
      { route: "/docs/:page" },
    ];
    expect(matchRoute(pages, "/docs/intro")?.entry.route).toBe("/docs/:page");
    expect(matchRoute(pages, "/docs/guide/intro")?.entry.route).toBe("/docs/*");
    expect(matchRoute(pages, "/pricing")?.entry.route).toBe("/*");
  });

  it("binds a segment as it is written when its escapes do not read", () => {
    expect(matchRoute(entries, "/invoices/100%")?.params).toEqual({
      id: "100%",
    });
    expect(matchRoute(entries, "/invoices/a%20b")?.params).toEqual({
      id: "a b",
    });
  });

  it("answers with nothing when no page serves the route", () => {
    expect(matchRoute(entries, "/nowhere")).toBeNull();
  });
});
