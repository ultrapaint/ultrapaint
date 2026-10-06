import "../testing/fake-browser.ts";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { belongsTo } from "./documents.ts";
import { useProject } from "./project.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const canvas = (id: string) => ({ home: "/", id, name: id, variants: [] });

beforeEach(() => {
  useProject.setState({
    canvases: [canvas(""), canvas("marketing"), canvas("marketing/promo")],
  });
});

describe("belongsTo", () => {
  it("holds the canvas's own pages and its loose nodes", () => {
    expect(belongsTo("marketing/home.page.json", "marketing")).toBe(true);
    expect(belongsTo(canvasDocOf("marketing"), "marketing")).toBe(true);
  });

  it("leaves a nested canvas's pages to it", () => {
    expect(belongsTo("marketing/promo/sale.page.json", "marketing")).toBe(
      false
    );
    expect(belongsTo("marketing/promo/sale.page.json", "marketing/promo")).toBe(
      true
    );
    expect(belongsTo("about.page.json", "")).toBe(true);
    expect(belongsTo("marketing/home.page.json", "")).toBe(false);
  });

  it("holds no other canvas's loose nodes, and nothing with no canvas open", () => {
    expect(belongsTo(canvasDocOf("marketing/promo"), "marketing")).toBe(false);
    expect(belongsTo("marketing/home.page.json", null)).toBe(false);
  });
});
