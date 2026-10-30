import "../testing/fake-browser.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "../testing/fake-browser.ts";
import { linkToNode, readUrl, writeBoard, writeUrl } from "./url.ts";

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
    writeUrl({ canvas: "main", page: null, route: "/", variant: null }, false);
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
