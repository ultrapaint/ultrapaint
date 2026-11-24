// @vitest-environment happy-dom

import type { DesignNode } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { select, selectMany } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { frameOf } from "./editor-frame.ts";
import { cancelGesture, useSpacingDrag } from "./frame-gesture.ts";
import { SelectionChrome } from "./selection-chrome.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const FRAME = { height: 900, width: 1440 };

const text = (id: string) =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

const page = {
  children: [
    {
      children: [text("title"), text("lede")],
      gap: 8,
      id: "hero",
      padding: 16,
      type: "row",
    },
    { children: [text("inside")], id: "box", type: "group" },
    { component: "Promo", from: "#app", id: "promo", type: "instance" },
  ],
  id: "home",
  type: "page",
} as DesignNode;

const rects = {
  box: { height: 40, width: 100, x: 0, y: 100 },
  hero: { height: 52, width: 132, x: 0, y: 0 },
  home: { height: 900, width: 1440, x: 0, y: 0 },
  lede: { height: 20, width: 50, x: 74, y: 16 },
  promo: { height: 60, width: 100, x: 0, y: 190 },
  "promo/bar": { height: 40, width: 100, x: 0, y: 200 },
  title: { height: 20, width: 50, x: 16, y: 16 },
};

let mounted: Root | null = null;

const show = () => {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  const r = mounted;
  act(() =>
    r.render(<SelectionChrome frame={FRAME} frameId={HOME} isNode={false} />)
  );
};

/** The bands drawn, by their keys. */
const bands = () =>
  [...document.querySelectorAll<HTMLElement>("[data-spacing-band]")].map(
    (el) => el.dataset.spacingBand
  );

const band = (key: string) =>
  document.querySelector<HTMLElement>(`[data-spacing-band="${key}"]`);

const initial = {
  components: useComponents.getState(),
  documents: useDocuments.getState(),
  editor: useEditor.getState(),
  project: useProject.getState(),
  spacingDrag: useSpacingDrag.getState(),
};

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
    info: { configured: true, storage: { mode: "managed" } },
    pages: [],
  });
  useEditor.setState({
    canvas: "main",
    frames: { [HOME]: { ...FRAME, preset: "desktop", x: 0, y: 0 } },
    rects: { [HOME]: rects },
    view: { x: 0, y: 0, zoom: 1 },
  });
  useDocuments.setState({
    canvas: "main",
    docs: { [HOME]: { doc: HOME, hash: `${HOME}@0`, root: page } },
    loaded: true,
  });
  useComponents.setState({
    components: [
      {
        name: "Promo",
        origin: "app",
        properties: [],
        slots: [],
        tree: {
          children: [
            { children: [text("sale")], id: "bar", type: "row" } as DesignNode,
          ],
          id: "p-root",
          type: "column",
        },
        version: 1,
      },
    ],
    status: "ready",
  });
  // The frame draws the hero's children where `rects` has them; it is mounted nowhere here.
  const frame = Object.getPrototypeOf(frameOf(HOME)) as ReturnType<
    typeof frameOf
  >;
  vi.spyOn(frame, "measure").mockImplementation((ids) =>
    Object.fromEntries(
      ids.flatMap((id) => {
        const rect = rects[id as keyof typeof rects];
        return rect ? [[id, rect]] : [];
      })
    )
  );
});

afterEach(() => {
  cancelGesture();
  const r = mounted;
  mounted = null;
  act(() => r?.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  useComponents.setState(initial.components, true);
  useDocuments.setState(initial.documents, true);
  useEditor.setState(initial.editor, true);
  useProject.setState(initial.project, true);
  useSpacingDrag.setState(initial.spacingDrag, true);
});

describe("a stack's spacing bands on the selection (ADR 0145)", () => {
  it("draws a row's gap between its children and a band on each side of its padding", () => {
    select({ frame: HOME, nodeId: "hero" });
    show();
    expect(bands()).toEqual([
      "gap-0",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
    ]);
    // Between the title's right edge and the lede's left, inside the hero's box.
    expect(band("gap-0")?.style.left).toBe("66px");
    expect(band("gap-0")?.style.width).toBe("8px");
  });

  it("draws them in the selection's blue on a plain element", () => {
    select({ frame: HOME, nodeId: "hero" });
    show();
    expect(band("gap-0")?.style.color).toBe("var(--selection)");
  });

  it("draws a page's padding bands, the page being the screen's column", () => {
    select({ frame: HOME, nodeId: "home" });
    show();
    expect(bands()).toEqual(
      expect.arrayContaining([
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
      ])
    );
  });

  it("draws a layer of an app component's instance in the component's purple", () => {
    select({ frame: HOME, nodeId: "promo/bar" });
    show();
    expect(band("padding-top")?.style.color).toBe("var(--component)");
  });

  it.each([
    ["a group", "box"],
    ["a text", "title"],
    ["an instance", "promo"],
  ])("draws none on %s", (_, nodeId) => {
    select({ frame: HOME, nodeId });
    show();
    expect(bands()).toEqual([]);
  });

  it("draws none with several selected", () => {
    selectMany([
      { frame: HOME, nodeId: "hero" },
      { frame: HOME, nodeId: "box" },
    ]);
    show();
    expect(bands()).toEqual([]);
  });

  it("starts the spacing drag on a press on a band, which goes no further than the band", () => {
    select({ frame: HOME, nodeId: "hero" });
    show();
    const heard = vi.fn();
    document.body.addEventListener("pointerdown", heard);
    act(() => {
      band("gap-0")?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 70,
          clientY: 20,
          pointerId: 1,
        })
      );
    });
    expect(heard).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          buttons: 1,
          clientX: 78,
          clientY: 20,
          pointerId: 1,
        })
      );
    });
    expect(useSpacingDrag.getState().dragged).toMatchObject({
      frame: HOME,
      keys: ["gap-0"],
      label: "Gap 16 · spacing-4",
    });
    // Drawn while it is dragged, its pill saying the value it is at.
    expect(band("gap-0")?.textContent).toBe("Gap 16 · spacing-4");
    document.body.removeEventListener("pointerdown", heard);
  });

  it("draws both sides of the padding's axis while Shift drags one, its pill on the one pressed", () => {
    select({ frame: HOME, nodeId: "hero" });
    show();
    act(() => {
      band("padding-top")?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 60,
          clientY: 8,
          pointerId: 1,
        })
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          buttons: 1,
          clientX: 60,
          clientY: 16,
          pointerId: 1,
          shiftKey: true,
        })
      );
    });
    expect(band("padding-top")?.textContent).toBe("Padding 24 · spacing-6");
    expect(band("padding-bottom")?.textContent).toBe("");
    expect(useSpacingDrag.getState().dragged?.keys).toEqual([
      "padding-top",
      "padding-bottom",
    ]);
  });
});
