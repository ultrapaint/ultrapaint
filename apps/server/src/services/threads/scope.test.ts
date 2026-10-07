import { describe, expect, it } from "vitest";
import { scopeOf } from "./turns.ts";

describe("a thread's scope", () => {
  it("is the first node its first prompt attached, a component when it is one", () => {
    expect(
      scopeOf([
        { kind: "file", path: "docs/designs/orders.page.json" },
        {
          component: true,
          file: "docs/designs/orders.page.json",
          kind: "selection",
          name: "Orders table",
          nodeId: "i_1",
        },
        {
          file: "docs/designs/orders.page.json",
          kind: "selection",
          name: "Header",
          nodeId: "r_2",
        },
      ])
    ).toEqual({
      component: true,
      count: 2,
      file: "docs/designs/orders.page.json",
      name: "Orders table",
      nodeId: "i_1",
    });
  });

  it("is the page when no node was attached, and nothing without either", () => {
    expect(
      scopeOf([
        { kind: "file", path: "docs/designs/settings/billing.page.json" },
      ])
    ).toEqual({
      file: "docs/designs/settings/billing.page.json",
      name: "Billing",
    });
    expect(scopeOf([])).toBeNull();
  });
});
