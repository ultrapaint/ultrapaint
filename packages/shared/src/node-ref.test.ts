import { describe, expect, it } from "vitest";
import { formatNodeRef, parseEditorLink, parseNodeRef } from "./node-ref.ts";

describe("node references", () => {
  it("read a route and a node id", () => {
    expect(parseNodeRef("/orders#c_8x2k1q")).toEqual({
      nodeId: "c_8x2k1q",
      page: "/orders",
    });
    expect(parseNodeRef("/invoices/:id#t_1")).toEqual({
      nodeId: "t_1",
      page: "/invoices/:id",
    });
  });

  it("read a canvas and the canvas", () => {
    expect(parseNodeRef("marketing:/pricing#r_2")).toEqual({
      canvas: "marketing",
      nodeId: "r_2",
      page: "/pricing",
    });
    expect(parseNodeRef("canvas#g_3")).toEqual({ nodeId: "g_3", page: null });
  });

  it("read a canvas inside another, which the colon ends", () => {
    expect(parseNodeRef("app/v2:/pricing#c_1")).toEqual({
      canvas: "app/v2",
      nodeId: "c_1",
      page: "/pricing",
    });
    expect(parseNodeRef("app/v2:drafts/hero.page.json#c_1")).toEqual({
      canvas: "app/v2",
      nodeId: "c_1",
      page: "drafts/hero.page.json",
    });
    expect(parseNodeRef("app/v2:canvas#g_3")).toEqual({
      canvas: "app/v2",
      nodeId: "g_3",
      page: null,
    });
    expect(parseNodeRef("Café/v2.1:/pricing#c_1")).toMatchObject({
      canvas: "Café/v2.1",
    });
  });

  it("read a URL with a colon in it as a URL, never as a canvas", () => {
    // A canvas never starts with a slash, so what does is a page's URL to its end.
    expect(parseNodeRef("/app/v2:/pricing#c_1")).toEqual({
      nodeId: "c_1",
      page: "/app/v2:/pricing",
    });
    expect(parseNodeRef("/a/:/b#c_1")).toEqual({
      nodeId: "c_1",
      page: "/a/:/b",
    });
    expect(parseNodeRef("marketing:/invoices/:id#t_1")).toEqual({
      canvas: "marketing",
      nodeId: "t_1",
      page: "/invoices/:id",
    });
  });

  it("read no canvas out of a name no canvas can have", () => {
    for (const text of [
      "app//v2:/pricing#c_1",
      "app/:/pricing#c_1",
      "app/.git:/pricing#c_1",
      "..:/pricing#c_1",
      "app\\v2:/pricing#c_1",
      ":/pricing#c_1",
    ]) {
      expect(parseNodeRef(text), text).toBeNull();
    }
  });

  it("read the file of a page without a URL", () => {
    expect(parseNodeRef("drafts/orders.page.json#c_1")).toEqual({
      nodeId: "c_1",
      page: "drafts/orders.page.json",
    });
    expect(parseNodeRef("marketing:hero@bold.page.json#c_1")).toEqual({
      canvas: "marketing",
      nodeId: "c_1",
      page: "hero@bold.page.json",
    });
  });

  it("are not read out of anything else", () => {
    expect(parseNodeRef("c_8x2k1q")).toBeNull();
    expect(parseNodeRef("/orders")).toBeNull();
    expect(parseNodeRef("see /orders#x and more")).toBeNull();
  });

  it("come back as they were written", () => {
    for (const text of [
      "/orders#c_1",
      "canvas#g_3",
      "marketing:/pricing#r_2",
      "drafts/orders.page.json#c_1",
    ]) {
      const ref = parseNodeRef(text);
      expect(ref && formatNodeRef(ref)).toBe(text);
    }
  });

  it("are read back as they were written, in a canvas inside another too", () => {
    for (const ref of [
      { canvas: "app/v2", nodeId: "c_1", page: "/pricing" },
      { canvas: "app/v2", nodeId: "c_1", page: "drafts/hero.page.json" },
      { canvas: "flows/sign-in/v2.1", nodeId: "g_3", page: null },
    ]) {
      expect(parseNodeRef(formatNodeRef(ref))).toEqual(ref);
    }
  });

  it("read a link the editor copies to one node", () => {
    expect(
      parseNodeRef(
        "http://localhost:4643/?canvas=redesign&route=/vibe&node=c_1"
      )
    ).toEqual({ canvas: "redesign", nodeId: "c_1", page: "/vibe" });
    expect(
      parseNodeRef(
        "http://localhost:4643/?canvas=redesign&page=redesign%2Fdraft.page.json&node=c_1"
      )
    ).toEqual({
      canvas: "redesign",
      nodeId: "c_1",
      page: "redesign/draft.page.json",
    });
    // Neither route nor page: a node beside the pages.
    expect(parseNodeRef("https://editor.example/?node=g_3")).toEqual({
      nodeId: "g_3",
      page: null,
    });
    expect(parseNodeRef("https://example.com/?q=1")).toBeNull();
  });
});

describe("editor links", () => {
  it("name a page without a node", () => {
    expect(
      parseEditorLink("http://localhost:4643/?canvas=samples&route=/pricing")
    ).toEqual({ canvas: "samples", page: "/pricing" });
  });

  it("are not read out of anything else", () => {
    expect(parseEditorLink("/pricing")).toBeNull();
    expect(parseEditorLink("http://localhost:4643/?canvas=samples")).toBeNull();
    expect(parseEditorLink("http://localhost:4643/?node=a b")).toBeNull();
  });
});
