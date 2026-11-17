// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { VariationSets } from "@ultrapaint/contracts/variations";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { editFrameAs, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { select } from "../state/selection.ts";
import { followServer } from "../state/server-data.ts";
import {
  loadVariations,
  previewedComponents,
  useVariations,
} from "../state/variations.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { AppInspector } from "./app-inspector.tsx";
import { Inspector } from "./inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";

const text = (id: string, words: string): DesignNode =>
  ({ id, role: "paragraph", text: words, type: "text" }) as DesignNode;
const image = (src: string): DesignNode =>
  ({ alt: "", id: "hero", src, type: "image" }) as DesignNode;

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [
      text("title", "Drawing with constraints"),
      image("assets/desk.jpg"),
      { children: [text("cta", "Subscribe")], id: "card", type: "column" },
      text("lede", "A grid is not a cage."),
    ],
    id: "home",
    type: "page",
  } as DesignNode,
};

/** A text's, an image's and a container's variations, the original in use but the card's. */
const SETS: VariationSets = {
  card: {
    inUse: "v2",
    variations: [
      { id: "original", name: "Original" },
      { id: "v2", name: "Editorial", varied: "Tone of the copy" },
    ],
  },
  hero: {
    inUse: "original",
    variations: [
      { id: "original", name: "Original" },
      { id: "v2", name: "Variation 2", tree: image("assets/plant.jpg") },
    ],
  },
  title: {
    inUse: "original",
    variations: [
      { id: "original", name: "Original" },
      { id: "v2", name: "Variation 2", tree: text("title", "Constraints") },
    ],
  },
};

const initialEditor = useEditor.getState();
const initialVariations = useVariations.getState();

let mounted: Root;
let container: HTMLElement;
let stop: () => void = () => undefined;

beforeEach(async () => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "", name: "Main", variants: [] }],
    info: { configured: true, storage: { mode: "managed" } },
    pages: [
      {
        canvas: "",
        file: `designs/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
        route: "/",
      },
    ],
  });
  useEditor.setState(initialEditor, true);
  useEditor.setState({
    canvas: "",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  useVariations.setState(initialVariations, true);
  editFrameAs(null);
  useIsolation.setState({ isolated: null });
  useDocuments.setState({ canvas: "", docs: { [HOME]: home } });
  fakeApi.respond("variations.list", () => ({
    documents: [{ doc: HOME, sets: SETS }],
    rounds: [],
  }));
  stop = followServer({ report: () => undefined });
  await loadVariations("");
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<Inspector />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  stop();
});

/** The section's rows, each as it reads. */
const rows = () =>
  [...container.querySelectorAll("[data-variation-row]")].map(
    (row) => row.textContent
  );

describe("the inspector's Variations section", () => {
  it("shows for a thing with only its original, whose + makes the first one by hand", async () => {
    fakeApi.respond("variations.add", ({ doc }) => ({ doc, sets: SETS }));
    act(() => select({ frame: HOME, nodeId: "lede" }));
    expect(container.textContent).toContain("Variations");
    expect(rows()).toEqual([]);

    act(() =>
      (
        container.querySelector('[aria-label="New variation"]') as HTMLElement
      ).click()
    );
    await fakeApi.requested("variations.add");
    expect(fakeApi.calls.at(-1)).toEqual({
      input: { doc: HOME, node: "lede" },
      method: "variations.add",
    });
  });

  it("reads a text's rows as its words, the one in use as the page has it", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    expect(rows()).toEqual(["Drawing with constraintsIn use", "Constraints"]);
  });

  it("shows an image's rows as its pictures", () => {
    act(() => select({ frame: HOME, nodeId: "hero" }));
    const pictures = [
      ...container.querySelectorAll("[data-variation-row] img"),
    ];
    // Asked of the server, on its own address (ADR 0100).
    const asked = pictures.map((img) => {
      const url = new URL(img.getAttribute("src") ?? "");
      return `${url.pathname}${url.search}`;
    });
    expect(asked).toEqual([
      "/api/asset?canvas=&src=assets%2Fdesk.jpg",
      "/api/asset?canvas=&src=assets%2Fplant.jpg",
    ]);
  });

  it("names anything else's rows, with what each varied", () => {
    act(() => select({ frame: HOME, nodeId: "card" }));
    expect(rows()).toEqual(["Original", "EditorialTone of the copyIn use"]);
  });

  it("lays the variations out with a row's in the preview when it is clicked", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    act(() =>
      (
        container.querySelector('[data-variation-row="v2"]') as HTMLElement
      ).click()
    );
    expect(useVariations.getState().open).toMatchObject({
      doc: HOME,
      frame: HOME,
      node: "title",
      preview: "v2",
    });
    // Nothing is selected: the right panel closes for the variations.
    expect(useEditor.getState().selection).toBeNull();
  });
});

describe("a component's main tree's variations", () => {
  const PROMO = "component:Promo";
  const tree = {
    children: [text("sale", "Sale")],
    id: "p-root",
    type: "column",
  } as DesignNode;
  const louder = {
    children: [text("sale", "SALE NOW")],
    id: "p-root",
    type: "column",
  } as DesignNode;

  beforeEach(async () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree,
          version: 1,
        } as never,
      ],
    });
    fakeApi.respond("variations.list", () => ({
      documents: [
        {
          doc: PROMO,
          sets: {
            "p-root": {
              inUse: "original",
              variations: [
                { id: "original", name: "Original" },
                { id: "v2", name: "Louder", tree: louder },
              ],
            },
          },
        },
      ],
      rounds: [],
    }));
    await loadVariations("");
    act(() => mounted.render(<AppInspector name="Promo" />));
  });

  it("are listed under its Variants, and shown on its board and its instances without writing", () => {
    const said = container.textContent ?? "";
    expect(said.indexOf("Variations")).toBeGreaterThan(
      said.indexOf("Variants")
    );
    expect(rows()).toEqual(["OriginalIn use", "Louder"]);

    act(() =>
      (
        container.querySelector('[data-variation-row="v2"]') as HTMLElement
      ).click()
    );
    expect(useVariations.getState().open).toMatchObject({
      doc: PROMO,
      frame: "board:library/Promo/component",
      preview: "v2",
    });
    const drawn = previewedComponents(useComponents.getState().components);
    expect(drawn.map((c) => (c as { tree?: DesignNode }).tree)).toEqual([
      louder,
    ]);
    expect(
      fakeApi.calls.filter(
        (c) =>
          c.method.startsWith("variations.") && c.method !== "variations.list"
      )
    ).toEqual([]);
  });
});
