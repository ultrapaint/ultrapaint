import "../testing/fake-browser.ts";
import { parseEditorLink } from "@ultrapaint/shared/node-ref";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "../testing/fake-browser.ts";
import {
  linkToNode,
  readUrl,
  setLinkProject,
  tidyUrl,
  writeBoard,
  writeUrl,
} from "./url.ts";

beforeEach(() => {
  fakeBrowser.visit("/?canvas=main&route=/pricing");
});

describe("a board view in the URL", () => {
  it("is read beside the canvas and the page", () => {
    fakeBrowser.visit("/?canvas=main&route=/pricing&view=system&item=color");
    expect(readUrl()).toMatchObject({
      board: { item: "color", view: "system" },
      canvas: "main",
      route: "/pricing",
    });
    fakeBrowser.visit("/?canvas=main&view=library");
    expect(readUrl().board).toEqual({ item: null, view: "library" });
    fakeBrowser.visit("/?canvas=main");
    expect(readUrl().board).toBeNull();
  });

  it("is written after the place, and taken away whole", () => {
    writeBoard({ item: "Button", view: "library" }, true);
    expect(window.location.search).toBe(
      "?canvas=main&route=%2Fpricing&view=library&item=Button"
    );
    writeBoard(null, true);
    expect(window.location.search).toBe("?canvas=main&route=%2Fpricing");
    // Opened and left: two navigations, which back walks.
    expect(fakeBrowser.history().entries).toHaveLength(3);
  });

  it("stays while the editor catches up with its place", () => {
    writeBoard({ item: "color", view: "system" }, false);
    writeUrl({ canvas: "main", page: null, route: "/", variant: null }, false, {
      item: "color",
      view: "system",
    });
    expect(readUrl()).toMatchObject({
      board: { item: "color", view: "system" },
      route: "/",
    });
  });

  it("is no part of a link to a node, which leads to the page", () => {
    writeBoard({ item: "color", view: "system" }, false);
    const link = new URL(
      linkToNode({ canvas: "main", nodeId: "hero", route: "/pricing" })
    );
    expect(link.searchParams.get("view")).toBeNull();
    expect(link.searchParams.get("item")).toBeNull();
    expect(link.searchParams.get("node")).toBe("hero");
  });
});

describe("a link to a page or a node", () => {
  it("names the project's folder once the project is saved, for an agent outside the editor (ADR 0083)", () => {
    setLinkProject("/home/u/Code/acme/ultrapaint.config.json");
    try {
      const link = linkToNode({ canvas: "main", nodeId: "hero", route: "/" });
      expect(parseEditorLink(link)).toMatchObject({
        nodeId: "hero",
        project: "/home/u/Code/acme",
      });
    } finally {
      setLinkProject(undefined);
    }
    expect(
      new URL(linkToNode({ canvas: "main", route: "/" })).searchParams.has(
        "project"
      )
    ).toBe(false);
  });

  it("says the variant of a variant's page beside its route, as the editor's own URL does", () => {
    const link = linkToNode({
      canvas: "main",
      nodeId: "hero",
      route: "/pricing",
      variant: "bold",
    });
    fakeBrowser.visit(link.slice(new URL(link).origin.length));
    expect(readUrl()).toMatchObject({
      canvas: "main",
      node: "hero",
      route: "/pricing",
      variant: "bold",
    });
  });

  it("says no variant for a base page, nor for a page named by its id", () => {
    const base = new URL(linkToNode({ canvas: "main", route: "/pricing" }));
    expect(base.searchParams.has("variant")).toBe(false);
    const byId = new URL(
      linkToNode({
        canvas: "main",
        page: "main/draft@bold.page.json",
        route: null,
        variant: "bold",
      })
    );
    expect(byId.searchParams.get("page")).toBe("main/draft@bold.page.json");
    expect(byId.searchParams.has("variant")).toBe(false);
  });
});

describe("tidyUrl", () => {
  it("drops what is empty or at its default, and keeps a parameter it has no table for", () => {
    fakeBrowser.visit("/?canvas=main&route=/&mode=vibe&variant=&constructor=x");
    tidyUrl();
    expect(window.location.search).toBe("?canvas=main&constructor=x");
  });
});
