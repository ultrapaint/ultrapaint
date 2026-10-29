import "../testing/fake-browser.ts";
import type {
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import { canvasDocOf, childrenOf } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { applyEdits, belongsTo, useDocuments } from "./documents.ts";
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
