// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBoard, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { editFrameAs, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { select, toggleSelected } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Inspector } from "./inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
/** Promo's board, which draws its tree with no variant to choose. */
const PROMO_BOARD = "board:library/Promo/component";

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

/** A title and a lede side by side, and a caption inside a card of its own. */
const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [
      text("title"),
      text("lede"),
      { children: [text("caption")], id: "card", type: "column" },
    ],
    id: "home",
    type: "page",
  } as DesignNode,
};

const initialEditor = useEditor.getState();
const initialBoard = useBoard.getState();

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
    info: { configured: true, storage: { mode: "managed" } },
    pages: [
      {
        canvas: "main",
        file: `designs/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
        route: "/",
      },
    ],
  });
  useComponents.setState({
    components: [
      {
        name: "Promo",
        origin: "app",
        properties: [],
        slots: [],
        tree: { children: [text("sale")], id: "p-root", type: "column" },
        version: 1,
      } as never,
    ],
  });
  useEditor.setState(initialEditor, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  useBoard.setState(initialBoard, true);
  // No component edited in place: neither its isolation nor the frame its edits went to.
  editFrameAs(null);
  useIsolation.setState({ isolated: null });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => mounted.render(<Inspector />));
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("the inspector's sections", () => {
  it("say where a node of a page leads in the prototype", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    expect(container.textContent).toContain("Prototype");
  });

  it("hold nothing of the code for a page: its implementation is the Code tab's", () => {
    act(() => select({ frame: HOME, nodeId: "home" }));
    expect(container.textContent).toContain("Route");
    expect(container.textContent).not.toContain("Implement");
  });

  it("have no prototype for a node of an app component's tree on its board", () => {
    act(() => {
      openBoard({ item: "Promo", view: "library" });
      select({ frame: PROMO_BOARD, nodeId: "sale" });
    });
    expect(useEditor.getState().selection?.nodeId).toBe("sale");
    expect(container.textContent).toContain("sale");
    expect(container.textContent).not.toContain("Prototype");
  });
});

/** The three Wrap buttons, by their name: "Wrap in a row", or why they cannot wrap. */
const WRAP = /wrap/i;

describe("the inspector's wrap actions", () => {
  const wrapButtons = () =>
    [...container.querySelectorAll("button")].filter((b) =>
      WRAP.test(b.getAttribute("aria-label") ?? "")
    );
  const disabled = () => wrapButtons().map((b) => b.disabled);

  it("follow the selection from siblings to nodes of two parents and back", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    act(() => toggleSelected({ frame: HOME, nodeId: "lede" }));
    expect(disabled()).toEqual([false, false, false]);
    act(() => toggleSelected({ frame: HOME, nodeId: "caption" }));
    expect(disabled()).toEqual([true, true, true]);
    act(() => toggleSelected({ frame: HOME, nodeId: "caption" }));
    expect(disabled()).toEqual([false, false, false]);
  });
});

describe("the inspector's spacing fields", () => {
  /** ⌘-click on a field, which picks it to be set with the others picked. */
  const pickField = (title: string) => {
    const target = container.querySelector(`[aria-label="${title}"]`);
    if (!target) {
      throw new Error(`no field ${title}`);
    }
    act(() => {
      target.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, metaKey: true })
      );
    });
  };
  const picked = () => container.querySelectorAll("[data-picked]").length;

  it("picked for one node are not picked for the next one selected", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    pickField("Padding, left and right");
    pickField("Padding, top and bottom");
    expect(picked()).toBe(2);
    act(() => select({ frame: HOME, nodeId: "lede" }));
    expect(picked()).toBe(0);
  });
});

describe("an app component's instance and its layers (ADR 0114)", () => {
  /** What the last edit asked the server for. */
  const applied = () =>
    fakeApi.calls.findLast((c) => c.method === "documents.apply")?.input;
  const withPromo = (overrides?: Record<string, Record<string, unknown>>) =>
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...home,
          root: {
            children: [
              {
                component: "Promo",
                from: "#app",
                id: "promo",
                type: "instance",
                ...(overrides && { overrides }),
              },
            ],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === label
    );

  it("offers the main component, though it has no properties", () => {
    withPromo();
    act(() => select({ frame: HOME, nodeId: "promo" }));
    expect(button("Edit main component")).toBeDefined();
    act(() => button("Edit main component")?.click());
    expect(useIsolation.getState().isolated?.component).toBe("Promo");
  });

  it("names the instance a layer is in", () => {
    withPromo({ sale: { color: "red" } });
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    expect(
      container.querySelector("[data-instance-layer]")?.textContent
    ).toContain("In Promo · Promo");
  });

  it("marks each field the instance overrides, and gives it back from its mark", async () => {
    withPromo({ sale: { at: { md: { size: 20 } }, color: "red" } });
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    const marks = [...container.querySelectorAll("[data-overridden]")].map(
      (m) => m.getAttribute("data-overridden")
    );
    expect(marks.sort()).toEqual(["color", "size"]);
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    act(() =>
      (
        container.querySelector('[data-overridden="size"]') as HTMLElement
      ).click()
    );
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [
            { at: "md", id: "promo/sale", op: "update", set: { size: null } },
          ],
        },
      ],
      label: "Reset instance override",
    });
  });

  it("marks nothing on the page's own nodes", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    expect(container.querySelector("[data-overridden]")).toBeNull();
  });

  it("gives a layer's overridden field back to the main component", async () => {
    withPromo({ sale: { color: "red" } });
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    expect(
      container.querySelector('[data-override="color"]')?.textContent
    ).toBe("red");
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    const reset = container.querySelector(
      '[data-override="color"] ~ button'
    ) as HTMLButtonElement | null;
    act(() => reset?.click());
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [{ id: "promo/sale", op: "update", set: { color: null } }],
        },
      ],
      label: "Reset instance override",
    });
  });

  it("gives a nested instance's overrides back, the page's instance's others kept", async () => {
    useComponents.setState({
      components: [
        {
          name: "Badge",
          origin: "app",
          properties: [],
          slots: [],
          tree: { children: [text("dot")], id: "b-root", type: "row" },
          version: 1,
        },
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [
              text("sale"),
              {
                component: "Badge",
                from: "#app",
                id: "badge",
                type: "instance",
              },
            ],
            id: "p-root",
            type: "column",
          },
          version: 1,
        },
      ] as never,
    });
    withPromo({ "badge/dot": { color: "red" }, sale: { color: "blue" } });
    act(() => select({ frame: HOME, nodeId: "promo/badge" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    act(() => button("Reset all")?.click());
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [
            {
              id: "promo",
              op: "update",
              set: { overrides: { sale: { color: "blue" } } },
            },
          ],
        },
      ],
      label: "Reset all instance overrides",
    });
  });

  it("applies an instance's overrides to every instance", async () => {
    withPromo({ sale: { color: "red" } });
    act(() => select({ frame: HOME, nodeId: "promo" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    act(() => button("Apply to main")?.click());
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toEqual({
      edits: [
        {
          doc: "component:Promo",
          ops: [{ id: "sale", op: "update", set: { color: "red" } }],
        },
        {
          doc: HOME,
          ops: [{ id: "promo", op: "update", set: { overrides: null } }],
        },
      ],
      label: "Apply to Promo",
    });
  });
});
