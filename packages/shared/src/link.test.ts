import { describe, expect, it } from "vitest";
import { isBrokenLink, linksIn, linkTargetOf, pageOfLink } from "./link.ts";

const pages = [
  { path: "index.page.json", route: "/" },
  { path: "invoice.page.json", route: "/invoices/:id" },
  { path: "draft.page.json" },
  { path: "draft@bold.page.json", variant: "bold" },
];

describe("links", () => {
  it("read the four forms", () => {
    expect(linkTargetOf("back")).toEqual({ kind: "back" });
    expect(linkTargetOf("https://example.com")).toEqual({
      kind: "external",
      url: "https://example.com",
    });
    expect(linkTargetOf("/invoices/42/")).toEqual({
      kind: "url",
      route: "/invoices/42",
    });
    expect(linkTargetOf("draft.page.json")).toEqual({
      kind: "page",
      path: "draft.page.json",
    });
    expect(linkTargetOf("somewhere")).toBeNull();
  });

  it("lead to a page by its file or by its URL, parameters and all", () => {
    expect(pageOfLink(pages, "draft.page.json")?.path).toBe("draft.page.json");
    expect(pageOfLink(pages, "/invoices/42")?.path).toBe("invoice.page.json");
    expect(pageOfLink(pages, "back")).toBeNull();
  });

  it("are broken when the page is not there", () => {
    expect(isBrokenLink(pages, "gone.page.json")).toBe(true);
    expect(isBrokenLink(pages, "/nowhere")).toBe(true);
    expect(isBrokenLink(pages, "back")).toBe(false);
    expect(isBrokenLink(pages, "https://example.com")).toBe(false);
    expect(isBrokenLink(pages, "draft.page.json")).toBe(false);
  });

  it("are found anywhere in a tree", () => {
    expect(
      linksIn({
        children: [
          { id: "a", link: "back" },
          { children: [{ id: "c", link: "/" }], id: "b" },
        ],
        id: "root",
      })
    ).toEqual([
      { link: "back", nodeId: "a" },
      { link: "/", nodeId: "c" },
    ]);
  });
});
