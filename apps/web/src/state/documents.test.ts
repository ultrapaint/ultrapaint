import "../testing/fake-browser.ts";
import type {
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import { canvasDocOf, childrenOf } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import {
  applyEdits,
  belongsTo,
  boardFrameOf,
  boardOfFrame,
  drawnRootOf,
  isBoardFrame,
  isNodeFrame,
  isViewFrame,
  nodeFrameOf,
  pageOfFrame,
  useDocuments,
  viewFrameOf,
} from "./documents.ts";
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

const HOME = "home.page.json";
const text = (id: string, t: string) =>
  ({ id, text: t, type: "text" }) as DesignNode;
const pageOf = (title: string) =>
  ({
    children: [
      { children: [text("t", title)], id: "hero", type: "column" },
      { children: [text("f", "Footer")], id: "footer", type: "row" },
    ],
    id: "root",
    type: "page",
  }) as DesignNode;
const stateAt = (hash: string, title: string): DocumentState => ({
  doc: HOME,
  hash,
  root: pageOf(title),
});
/** The change of the title, over the state `from`. */
const retitled = (from: string, hash: string, title: string) => ({
  doc: HOME,
  from,
  hash,
  nodes: [{ node: { id: "t", text: title, type: "text" } }],
  rootId: "root",
});
const held = () => useDocuments.getState().docs[HOME];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a document's changes", () => {
  beforeEach(() => {
    fakeApi.reset();
    useDocuments.setState({
      canvas: "",
      docs: { [HOME]: stateAt("h1", "One") },
    });
  });

  it("go into the copy they were made over, what did not change kept as it was", () => {
    const before = held();
    useDocuments.getState().take(retitled("h1", "h2", "Two"));
    expect(held()).toEqual(stateAt("h2", "Two"));
    const [hero, footer] = childrenOf(held()?.root as DesignNode);
    const [heroBefore, footerBefore] = childrenOf(before?.root as DesignNode);
    expect(footer).toBe(footerBefore);
    expect(hero).not.toBe(heroBefore);
    expect(fakeApi.calls).toEqual([]);
  });

  it("read the document again over a copy that missed one, and take what came meanwhile after it", async () => {
    let answer: (state: DocumentState) => void = () => undefined;
    fakeApi.respond(
      "documents.get",
      () =>
        new Promise<DocumentState>((resolve) => {
          answer = resolve;
        })
    );
    useDocuments.getState().take(retitled("h2", "h3", "Three"));
    expect(fakeApi.calls.map((c) => c.method)).toEqual(["documents.get"]);
    // What is told while it is read waits for it.
    useDocuments.getState().take(retitled("h3", "h4", "Four"));
    expect(held()?.hash).toBe("h1");
    answer(stateAt("h3", "Three"));
    await settle();
    expect(held()).toEqual(stateAt("h4", "Four"));
    expect(fakeApi.calls).toHaveLength(1);
  });

  it("take the whole document as it is told, and the answer to an edit as the change it made", async () => {
    useDocuments.getState().take(stateAt("h9", "Whole"));
    expect(held()).toEqual(stateAt("h9", "Whole"));
    fakeApi.respond("documents.apply", () => ({
      changes: [retitled("h9", "h10", "Edited")],
      created: [],
    }));
    useProject.setState({
      info: { configured: true, storage: { mode: "managed" } },
    });
    await applyEdits([
      { doc: HOME, ops: [{ id: "t", op: "update", set: { text: "Edited" } }] },
    ]);
    expect(held()).toEqual(stateAt("h10", "Edited"));
  });
});

describe("a board's frame", () => {
  const frame = boardFrameOf({ item: "color", name: "light", view: "system" });

  it("is told apart from pages, their views and nodes", () => {
    expect(frame).toBe("board:system/color/light");
    expect(isBoardFrame(frame)).toBe(true);
    expect(isViewFrame(frame)).toBe(false);
    expect(isNodeFrame(frame)).toBe(false);
    for (const other of [
      "home.page.json",
      viewFrameOf("home.page.json", "md"),
      nodeFrameOf("n1"),
    ]) {
      expect(isBoardFrame(other)).toBe(false);
      expect(boardOfFrame(other)).toBeNull();
    }
  });

  it("names its board, an item with a slash in it too", () => {
    expect(boardOfFrame(frame)).toEqual({
      item: "color",
      name: "light",
      view: "system",
    });
    const odd = boardFrameOf({
      item: "guide-a/b#c",
      name: "document",
      view: "system",
    });
    expect(boardOfFrame(odd)).toEqual({
      item: "guide-a/b#c",
      name: "document",
      view: "system",
    });
    expect(isViewFrame(odd)).toBe(false);
    expect(pageOfFrame(odd)).toBe(odd);
  });

  it("draws none of the documents", () => {
    const docs = {
      [frame]: { doc: frame, hash: "x", root: pageOf("Not a page") },
    };
    expect(drawnRootOf(docs, "", frame)).toBeNull();
  });
});
