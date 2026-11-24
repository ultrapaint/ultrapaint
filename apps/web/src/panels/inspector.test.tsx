// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeymap } from "../lib/keymap.ts";
import { openBoard, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { editFrameAs, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useIsolation } from "../state/isolation.ts";
import { usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { select, toggleSelected } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Inspector } from "./inspector.tsx";

/** The inspector, with the editor's keys listening on the window as they do in the editor. */
const WithKeys = () => {
  useKeymap();
  return <Inspector />;
};

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
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<WithKeys />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
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

  it("says the main component edited at its top, Done going back to the page (ADR 0120)", () => {
    withPromo();
    act(() => select({ frame: HOME, nodeId: "promo" }));
    // The right panel put away, on the Code tab, comes back on Design with what it says.
    usePanels.setState({ right: true });
    useEditor.setState({ rightTab: "code" });
    act(() => button("Edit main component")?.click());
    expect(useEditor.getState().rightTab).toBe("design");
    const section = container.querySelector("[data-main-component]");
    expect(section?.textContent).toContain("Home");
    expect(section?.textContent).toContain("Promo");
    expect(section?.textContent).toContain("Main component · 1 instance");
    expect(usePanels.getState().right).toBe(false);
    act(() =>
      [...(section?.querySelectorAll("button") ?? [])]
        .find((b) => b.textContent?.startsWith("Done"))
        ?.click()
    );
    expect(useIsolation.getState().isolated).toBeNull();
    expect(useEditor.getState().selection?.nodeId).toBe("promo");
    expect(container.querySelector("[data-main-component]")).toBeNull();
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

  it("writes a field's default on a layer, so it overrides what the main component sets", async () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [{ ...text("sale"), align: "center" } as DesignNode],
            id: "p-root",
            type: "column",
          },
          version: 1,
        },
      ] as never,
    });
    withPromo();
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    const start = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Start" || b.title === "Start"
    );
    act(() => start?.click());
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toMatchObject({
      edits: [
        {
          doc: HOME,
          ops: [{ id: "promo/sale", op: "update", set: { align: "start" } }],
        },
      ],
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

  it("gives a nested instance's overrides back field by field, the page's instance's others kept", async () => {
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
          ops: [{ id: "promo/badge/dot", op: "update", set: { color: null } }],
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
          ops: [{ id: "promo/sale", op: "update", set: { color: null } }],
        },
      ],
      label: "Apply to Promo",
    });
  });
});

describe("the Text section", () => {
  const initialDesignSystem = useDesignSystem.getState();
  afterEach(() => useDesignSystem.setState(initialDesignSystem, true));
  /** What the last edit asked the server for. */
  const applied = () =>
    fakeApi.calls.findLast((c) => c.method === "documents.apply")?.input;
  const field = (name: string) =>
    container.querySelector(`[aria-label="${name}"]`);
  /** The words the Text section shows: its title, its labels and its fields' values. */
  const sectionText = () =>
    [...container.querySelectorAll("section")].find(
      (s) => s.querySelector("h3")?.textContent === "Text"
    )?.textContent ?? "";
  /** Lets the popover's and the select's opening settle. */
  const settle = () =>
    act(async () => {
      await Promise.resolve();
    });
  const formatting = () =>
    container.querySelector<HTMLElement>('[aria-label="Formatting"]');
  const popover = () =>
    document.querySelector<HTMLElement>('[data-slot="popover-content"]');
  const openFormatting = async () => {
    act(() => formatting()?.click());
    await settle();
  };
  /** Picks an option of the popover's Role. */
  const pickRole = async (label: string) => {
    const trigger = popover()?.querySelector<HTMLElement>(
      '[data-slot="select-trigger"]'
    );
    act(() => trigger?.click());
    await settle();
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent === label
    ) as HTMLElement | undefined;
    act(() => option?.click());
    await settle();
  };

  it("labels only the rows that keep a field each, size, weight, line height and tracking paired", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    const words = sectionText();
    for (const label of ["Style", "Font", "Colour", "Align"]) {
      expect(words).toContain(label);
    }
    for (const gone of ["Size", "Weight", "Line height", "Tracking", "Role"]) {
      expect(words).not.toContain(gone);
    }
  });

  it("names each paired field and leads it with its icon", () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    for (const name of ["Size", "Weight", "Line height", "Tracking"]) {
      expect(field(name)?.querySelector("svg")).not.toBeNull();
    }
  });

  it("names a field a text style gives by what it is, then by the style it comes from", () => {
    useDesignSystem.setState({
      designSystem: {
        colors: [],
        radius: [],
        shadows: [],
        spacing: { base: "0.25rem" },
        typography: {
          fonts: [],
          sizes: [],
          styles: [{ name: "Body", role: "paragraph", size: 16 }],
          weights: [],
        },
      } as never,
    });
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...home,
          root: {
            children: [{ ...text("title"), textStyle: "Body" } as DesignNode],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
    act(() => select({ frame: HOME, nodeId: "title" }));
    expect(
      field("Size: from Body; a change detaches it")?.querySelector("svg")
    ).not.toBeNull();
  });

  it("holds the role in a popover titled Formatting", async () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    await openFormatting();
    expect(
      popover()?.querySelector('[data-slot="popover-title"]')?.textContent
    ).toBe("Formatting");
    expect(popover()?.textContent).toContain("Role");
  });

  it("sets the role picked in Formatting at once, the popover staying open", async () => {
    act(() => select({ frame: HOME, nodeId: "title" }));
    await openFormatting();
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    await pickRole("Heading 2");
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toMatchObject({
      edits: [
        {
          doc: HOME,
          ops: [
            {
              id: "title",
              op: "update",
              set: { level: 2, role: "heading" },
            },
          ],
        },
      ],
    });
    expect(
      fakeApi.calls.filter((c) => c.method === "documents.apply")
    ).toHaveLength(1);
    expect(popover()?.hasAttribute("data-closed")).toBe(false);
  });

  it("closes Formatting on Escape, the selection kept", async () => {
    act(() => select({ frame: HOME, nodeId: "caption" }));
    await openFormatting();
    expect(popover()).not.toBeNull();
    const focused = (document.activeElement ?? document.body) as HTMLElement;
    act(() => {
      focused.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        })
      );
    });
    await settle();
    expect(popover()?.hasAttribute("data-closed") ?? true).toBe(true);
    expect(useEditor.getState().selection?.nodeId).toBe("caption");
  });

  it("reads Mixed for texts whose roles differ", async () => {
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...home,
          root: {
            children: [
              text("title"),
              { ...text("lede"), level: 2, role: "heading" } as DesignNode,
            ],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
    act(() => select({ frame: HOME, nodeId: "title" }));
    act(() => toggleSelected({ frame: HOME, nodeId: "lede" }));
    await openFormatting();
    expect(
      popover()?.querySelector('[data-slot="select-trigger"]')?.textContent
    ).toContain("Mixed");
  });

  it("marks the Formatting button where the instance overrides the role, and gives it back from the row's mark inside", async () => {
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
                overrides: { sale: { level: 2, role: "heading" } },
                type: "instance",
              },
            ],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    const mark = container.querySelector('[data-overridden="role level"]');
    expect(mark?.getAttribute("aria-label")).toContain("Formatting");
    await openFormatting();
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    act(() =>
      popover()
        ?.querySelector<HTMLElement>('[data-overridden="role level"]')
        ?.click()
    );
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [
            {
              id: "promo/sale",
              op: "update",
              set: { level: null, role: null },
            },
          ],
        },
      ],
      label: "Reset instance overrides",
    });
  });
});
