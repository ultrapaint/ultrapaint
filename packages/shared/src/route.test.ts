import { describe, expect, it } from "vitest";
import {
  matchRoute,
  normaliseRoute,
  pagePathOf,
  resolveTarget,
  routeLabel,
  routeOf,
} from "./route.ts";

describe("routes derived from page files", () => {
  it("reads a route off the path a page has inside its space", () => {
    expect(routeOf("index.tsx")).toBe("/");
    expect(routeOf("pricing.tsx")).toBe("/pricing");
    expect(routeOf("settings/index.tsx")).toBe("/settings");
    expect(routeOf("settings/billing.tsx")).toBe("/settings/billing");
    expect(routeOf("invoices/[id].tsx")).toBe("/invoices/:id");
    expect(routeOf("docs/[...rest].tsx")).toBe("/docs/*");
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

  it("takes anything else as a page file inside the space", () => {
    expect(resolveTarget("settings/billing.tsx")).toBe("/settings/billing");
    expect(resolveTarget("index.tsx")).toBe("/");
  });
});
