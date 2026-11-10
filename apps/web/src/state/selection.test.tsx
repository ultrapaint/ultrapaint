// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { select, toggleSelected, useSelectedAreSiblings } from "./selection.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

/** The home page with these nodes under its root. */
const homeWith = (children: DesignNode[], hash: string): DocumentState => ({
  doc: HOME,
  hash,
  root: { children, id: "home", type: "page" } as DesignNode,
});

const card = (children: DesignNode[]): DesignNode =>
  ({ children, id: "card", type: "column" }) as DesignNode;

const initial = useEditor.getState();

/** What the hook said at each render, the last one last. */
let said: boolean[];
const Probe = () => {
  said.push(useSelectedAreSiblings());
  return null;
};

let mounted: Root;

beforeEach(() => {
  fakeApi.reset();
  useEditor.setState(initial, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
  });
  // A title and a lede side by side, and a caption inside a card of its own.
  useDocuments.setState({
    canvas: "main",
    docs: {
      [HOME]: homeWith(
        [text("title"), text("lede"), card([text("caption")])],
        `${HOME}@0`
      ),
    },
    loaded: true,
  });
  said = [];
  mounted = createRoot(document.createElement("div"));
  act(() => mounted.render(<Probe />));
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("whether the nodes selected are siblings, for a component", () => {
  it("is no with nothing selected, and yes for one node inside another", () => {
    expect(said.at(-1)).toBe(false);
    act(() => select({ frame: HOME, nodeId: "title" }));
    expect(said.at(-1)).toBe(true);
  });

  it("follows the selection from one parent to two and back", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    act(() => toggleSelected({ frame: HOME, nodeId: "lede" }));
    expect(said.at(-1)).toBe(true);
    act(() => toggleSelected({ frame: HOME, nodeId: "caption" }));
    expect(said.at(-1)).toBe(false);
    act(() => toggleSelected({ frame: HOME, nodeId: "caption" }));
    expect(said.at(-1)).toBe(true);
  });

  it("follows a selected node moved to another parent in its document", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    act(() => toggleSelected({ frame: HOME, nodeId: "caption" }));
    expect(said.at(-1)).toBe(false);
    act(() =>
      useDocuments.setState({
        docs: {
          [HOME]: homeWith(
            [text("lede"), card([text("caption"), text("title")])],
            `${HOME}@1`
          ),
        },
      })
    );
    expect(said.at(-1)).toBe(true);
  });

  it("is no for a frame's root, which nothing holds", () => {
    act(() => select({ frame: HOME, nodeId: "home" }));
    expect(said.at(-1)).toBe(false);
  });
});
