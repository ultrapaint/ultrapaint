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
    writeUrl({ canvas: "main", page: null, route: "/" }, false, {
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

  it("says no variant, which only a link copied before ADR 0098 does", () => {
    const link = new URL(linkToNode({ canvas: "main", route: "/pricing" }));
    expect(link.searchParams.has("variant")).toBe(false);
  });

  it("reads such a link's variant, the page's variation to show", () => {
    fakeBrowser.visit("/?canvas=main&route=/pricing&variant=bold");
    expect(readUrl()).toMatchObject({ route: "/pricing", variant: "bold" });
  });
});

describe("tidyUrl", () => {
  it("drops what is empty or at its default, and keeps a parameter it has no table for", () => {
    fakeBrowser.visit("/?canvas=main&route=/&mode=vibe&variant=&constructor=x");
    tidyUrl();
    expect(window.location.search).toBe("?canvas=main&constructor=x");
  });
});
