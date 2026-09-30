import { describe, expect, it } from "vitest";
import {
  basePathOf,
  isVariantName,
  matchRoute,
  normaliseRoute,
  pageNameOf,
  pagePathOf,
  pageRouteOf,
  pagesInVariant,
  resolveTarget,
  routeLabel,
  routeOf,
  routesOf,
  variantOf,
  variantPathOf,
} from "./route.ts";

describe("a page's name and URL", () => {
  it("names a page after its file", () => {
    expect(pageNameOf("billing-settings.page.json")).toBe("Billing settings");
    expect(pageNameOf("index.page.json")).toBe("Home");
    expect(pageNameOf("settings/index.page.json")).toBe("Settings");
    expect(pageNameOf("invoices/[id].page.json")).toBe("Invoices id");
    expect(pageNameOf("pricing@bold.page.json")).toBe("Pricing");
  });

  it("serves the URL the canvas gives it, or none", () => {
    const routes = { "pricing.page.json": "/plans" };
    expect(pageRouteOf(routes, "pricing.page.json")).toBe("/plans");
    expect(pageRouteOf(routes, "pricing@bold.page.json")).toBe("/plans");
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

describe("variants of a page", () => {
  it("reads the variant off the file, and serves the base's route", () => {
    expect(variantOf("pricing@bold.page.json")).toBe("bold");
    expect(variantOf("settings/billing@dark-2.page.json")).toBe("dark-2");
    expect(variantOf("pricing.page.json")).toBeNull();
    expect(routeOf("pricing@bold.page.json")).toBe("/pricing");
    expect(routeOf("index@bold.page.json")).toBe("/");
    expect(routeOf("invoices/[id]@bold.page.json")).toBe("/invoices/:id");
  });

  it("goes between a base page's file and its variant's", () => {
    expect(basePathOf("settings/billing@bold.page.json")).toBe(
      "settings/billing.page.json"
    );
    expect(variantPathOf("settings/billing.page.json", "bold")).toBe(
      "settings/billing@bold.page.json"
    );
    expect(variantPathOf("pricing@calm.page.json", "bold")).toBe(
      "pricing@bold.page.json"
    );
  });

  it("names a variant with lowercase letters, digits and dashes", () => {
    expect(isVariantName("bold-2")).toBe(true);
    expect(isVariantName("Bold")).toBe(false);
    expect(isVariantName("")).toBe(false);
  });

  it("serves the variant's page where it has one, the base's elsewhere", () => {
    const pages = [
      { path: "index.page.json" },
      { path: "pricing.page.json" },
      { path: "pricing@bold.page.json", variant: "bold" },
      { path: "promo@bold.page.json", variant: "bold" },
      { path: "pricing@calm.page.json", variant: "calm" },
    ];
    expect(pagesInVariant(pages, null).map((p) => p.path)).toEqual([
      "index.page.json",
      "pricing.page.json",
    ]);
    expect(pagesInVariant(pages, "bold").map((p) => p.path)).toEqual([
      "index.page.json",
      "pricing@bold.page.json",
      "promo@bold.page.json",
    ]);
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

  it("names the file a route asks for, without an extension", () => {
    expect(pagePathOf("/")).toBe("index");
    expect(pagePathOf("/settings/billing")).toBe("settings/billing");
    expect(pagePathOf("invoices/:id")).toBe("invoices/[id]");
  });

  it("tolerates what a person types", () => {
    expect(normaliseRoute("")).toBe("/");
    expect(normaliseRoute("settings//billing/")).toBe("/settings/billing");
  });

  it("labels a route by its last segment", () => {
    expect(routeLabel("/")).toBe("Home");
    expect(routeLabel("/settings/sign-in")).toBe("Sign in");
    expect(routeLabel("/invoices/:id")).toBe("Id");
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

  it("answers with nothing when no page serves the route", () => {
    expect(matchRoute(entries, "/nowhere")).toBeNull();
  });
});

describe("what a link points at", () => {
  it("takes a path with a leading slash as a route", () => {
    expect(resolveTarget("/settings/billing")).toBe("/settings/billing");
  });

  it("takes anything else as a page file inside the canvas", () => {
    expect(resolveTarget("settings/billing.tsx")).toBe("/settings/billing");
    expect(resolveTarget("index.tsx")).toBe("/");
  });
});
