// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
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
      expect(field(name)?.querySelector("svg")).toBeInstanceOf(SVGElement);
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
    ).toBeInstanceOf(SVGElement);
  });

  describe("a text style's steps (ADR 0160)", () => {
    /** Body, which steps up at lg; the page's frame is 1440 wide, at xl. */
    const withBody = (title: Record<string, unknown>) => {
      useDesignSystem.setState({
        designSystem: {
          ...emptyDesignSystem(),
          typography: {
            ...emptyDesignSystem().typography,
            styles: [
              {
                at: { lg: { lineHeight: 1.4, size: 18 } },
                name: "Body",
                role: "paragraph",
                size: 16,
              },
            ],
          },
        },
      });
      useDocuments.setState({
        docs: {
          [HOME]: {
            ...home,
            root: {
              children: [
                { ...text("title"), textStyle: "Body", ...title } as DesignNode,
              ],
              id: "home",
              type: "page",
            } as DesignNode,
          },
        },
      });
      act(() => select({ frame: HOME, nodeId: "title" }));
    };
    const shown = (name: string) =>
      field(name)?.querySelector<HTMLInputElement>("input")?.value;
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label
      );

    it("shows what the style gives at the frame's breakpoint", () => {
      withBody({});
      expect(shown("Size: from Body; a change detaches it")).toBe("18");
      expect(shown("Line height: from Body; a change detaches it")).toBe("1.4");
    });

    it("marks the text's own size at a breakpoint as overriding its style there", () => {
      withBody({ at: { xl: { size: 20 } } });
      expect(shown("Size: its own, over Body")).toBe("20");
      expect(field("Line height: from Body; a change detaches it")).not.toBe(
        null
      );
    });

    it("detaches the text with the style's steps copied into its own, in one edit", async () => {
      withBody({});
      fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
      act(() => button("Detach style")?.click());
      await act(() => fakeApi.requested("documents.apply"));
      expect(applied()).toEqual({
        edits: [
          {
            doc: HOME,
            ops: [
              { id: "title", op: "update", set: { size: 16, textStyle: null } },
              {
                at: "lg",
                id: "title",
                op: "update",
                set: { lineHeight: 1.4, size: 18 },
              },
            ],
          },
        ],
        label: "Detach the text style",
      });
    });

    it("detaches the text in a view as the style draws there, its steps copied below", async () => {
      useEditor.setState({
        frames: {
          [HOME]: {
            height: 900,
            preset: "desktop",
            views: [{ height: 800, id: "w390", width: 390, x: 1520, y: 0 }],
            width: 1440,
            x: 0,
            y: 0,
          },
        },
      });
      withBody({});
      fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
      act(() => button("Detach style")?.click());
      await act(() => fakeApi.requested("documents.apply"));
      // The frame is a view at xl: the edit lands there, with the size Body has there.
      expect(applied()).toEqual({
        edits: [
          {
            doc: HOME,
            ops: [
              {
                at: "xl",
                id: "title",
                op: "update",
                set: { lineHeight: 1.4, size: 18, textStyle: null },
              },
              {
                at: "lg",
                id: "title",
                op: "update",
                set: { lineHeight: 1.4, size: 18 },
              },
            ],
          },
        ],
        label: "Detach the text style",
      });
    });

    it("sets a text in a style with its own sizes cleared at every breakpoint", async () => {
      withBody({ at: { md: { size: 20 } }, textStyle: undefined });
      fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
      act(() => button("Attach to a style")?.click());
      await act(() => fakeApi.requested("documents.apply"));
      expect(applied()).toMatchObject({
        edits: [
          {
            doc: HOME,
            ops: [
              { id: "title", op: "update", set: { textStyle: "Body" } },
              { at: "md", id: "title", op: "update", set: { size: null } },
            ],
          },
        ],
      });
    });
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

  /** The segment of a Formatting row (`Case`, `Wrap`, `Lines`) named or labelled `name`. */
  const segment = (row: string, name: string) =>
    [
      ...(popover()?.querySelectorAll<HTMLElement>(
        `[aria-label="${row}"] button`
      ) ?? []),
    ].find(
      (b) => b.getAttribute("aria-label") === name || b.textContent === name
    );
  /** The segments of a Formatting row pressed, by their text or name. */
  const pressed = (row: string) =>
    [
      ...(popover()?.querySelectorAll<HTMLElement>(
        `[aria-label="${row}"] button[aria-pressed="true"]`
      ) ?? []),
    ].map((b) => b.getAttribute("aria-label") ?? b.textContent);
  const withTexts = (...children: DesignNode[]) =>
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...home,
          root: { children, id: "home", type: "page" } as DesignNode,
        },
      },
    });

  it.each([
    ["Case", "Uppercase", { case: "upper" }, "Change the text's case"],
    ["Case", "As typed", { case: null }, "Change the text's case"],
    ["Wrap", "Balance", { textWrap: "balance" }, "Change how the text wraps"],
    ["Lines", "2", { lines: 2 }, "Change the text's lines"],
  ] as const)(
    "sets %s to %s from Formatting",
    async (row, name, set, label) => {
      withTexts({ ...text("title"), case: "lower" } as DesignNode);
      act(() => select({ frame: HOME, nodeId: "title" }));
      await openFormatting();
      fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
      act(() => segment(row, name)?.click());
      await act(() => fakeApi.requested("documents.apply"));
      expect(applied()).toEqual({
        edits: [{ doc: HOME, ops: [{ id: "title", op: "update", set }] }],
        label,
      });
    }
  );

  it("picks what the texts share, and no segment where they differ", async () => {
    withTexts(
      { ...text("title"), lines: 1, textWrap: "none" } as DesignNode,
      { ...text("lede"), lines: 2, textWrap: "none" } as DesignNode
    );
    act(() => select({ frame: HOME, nodeId: "title" }));
    act(() => toggleSelected({ frame: HOME, nodeId: "lede" }));
    await openFormatting();
    expect(pressed("Case")).toEqual(["As typed"]);
    expect(pressed("Wrap")).toEqual(["None"]);
    expect(pressed("Lines")).toEqual([]);
  });

  it("picks no Lines segment for lines the row does not offer", async () => {
    withTexts({ ...text("title"), lines: 5 } as DesignNode);
    act(() => select({ frame: HOME, nodeId: "title" }));
    await openFormatting();
    expect(pressed("Lines")).toEqual([]);
  });

  it("marks the Formatting button where the instance overrides a text's lines", () => {
    withTexts({
      component: "Promo",
      from: "#app",
      id: "promo",
      overrides: { sale: { lines: 2 } },
      type: "instance",
    } as DesignNode);
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    expect(
      container
        .querySelector('[data-overridden="lines"]')
        ?.getAttribute("aria-label")
    ).toContain("Formatting");
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

describe("the Colours used section", () => {
  const initialDesignSystem = useDesignSystem.getState();
  beforeEach(() => {
    const ds = {
      ...emptyDesignSystem(),
      colors: [
        {
          name: "Semantic",
          tokens: [{ name: "color-primary", value: "#2563eb" }],
        },
      ],
    };
    useDesignSystem.setState({ designSystem: ds, saved: ds });
  });
  afterEach(() => useDesignSystem.setState(initialDesignSystem, true));

  const applied = () =>
    fakeApi.calls.findLast((c) => c.method === "documents.apply")?.input;
  const showing = (children: readonly DesignNode[]) =>
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...home,
          root: { children, id: "home", type: "page" } as DesignNode,
        },
      },
    });
  /** A card holding a heading and a lede, white twice, the lede's primary at a breakpoint. */
  const card = (): DesignNode =>
    ({
      children: [
        { ...text("title"), color: "#fff" },
        { ...text("lede"), at: { md: { color: "$color-primary" } } },
      ],
      fill: "#ffffff",
      id: "card",
      type: "column",
    }) as DesignNode;
  const section = () =>
    [...container.querySelectorAll("section")].find(
      (s) => s.querySelector("h3")?.textContent === "Colours used"
    );
  /** Each row as its label and what its field shows. */
  const rows = () =>
    [...(section()?.querySelectorAll('input[role="combobox"]') ?? [])].map(
      (input) => [
        input.closest(".grid")?.firstElementChild?.textContent ?? "",
        (input as HTMLInputElement).value,
      ]
    );
  const fieldShowing = (value: string) => {
    const found = [
      ...(section()?.querySelectorAll<HTMLInputElement>(
        'input[role="combobox"]'
      ) ?? []),
    ].find((input) => input.value === value);
    if (!found) {
      throw new Error(`no field shows ${value}`);
    }
    return found;
  };
  const openField = (value: string) => {
    const input = fieldShowing(value);
    act(() => {
      input.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 })
      );
    });
  };
  const options = () => [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ];
  const pick = (label: string) => {
    const found = options().find((o) => o.textContent?.startsWith(label));
    if (!found) {
      throw new Error(`no option ${label}`);
    }
    act(() => found.click());
  };

  it("lists a column's colours a row each, labelled by how many times each is used", () => {
    showing([card()]);
    act(() => select({ frame: HOME, nodeId: "card" }));
    expect(rows()).toEqual([
      ["2 uses", "#ffffff"],
      ["1 use", "primary"],
    ]);
  });

  it("lists the colours of several elements selected together", () => {
    showing([
      { ...text("a"), color: "#ff0000" },
      { ...text("b"), color: "#00ff00" },
    ] as DesignNode[]);
    act(() => {
      select({ frame: HOME, nodeId: "a" });
      toggleSelected({ frame: HOME, nodeId: "b" });
    });
    expect(rows()).toEqual([
      ["1 use", "#ff0000"],
      ["1 use", "#00ff00"],
    ]);
  });

  it("lists every colour of the page selected", () => {
    showing([card(), { ...text("aside"), color: "#ff0000" }] as DesignNode[]);
    act(() => select({ frame: HOME, nodeId: "home" }));
    expect(rows()).toEqual([
      ["2 uses", "#ffffff"],
      ["1 use", "primary"],
      ["1 use", "#ff0000"],
    ]);
  });

  it("is not shown for one text or one image", () => {
    showing([
      { ...text("a"), color: "#ff0000" },
      { id: "icon", src: "i.svg", tint: "#ff0000", type: "image" },
    ] as DesignNode[]);
    act(() => select({ frame: HOME, nodeId: "a" }));
    expect(section()).toBeUndefined();
    act(() => select({ frame: HOME, nodeId: "icon" }));
    expect(section()).toBeUndefined();
  });

  it("lists the colours one app component's instance overrides on its layers", () => {
    showing([
      {
        component: "Promo",
        from: "#app",
        id: "promo",
        overrides: { sale: { at: { md: { color: "#ff0000" } } } },
        type: "instance",
      },
    ] as DesignNode[]);
    act(() => select({ frame: HOME, nodeId: "promo" }));
    expect(rows()).toEqual([["1 use", "#ff0000"]]);
  });

  it("marks a raw colour outside the design system, and not a token", () => {
    showing([card()]);
    act(() => select({ frame: HOME, nodeId: "card" }));
    const dotOn = (value: string) =>
      fieldShowing(value)
        .closest('[data-slot="input-group"]')
        ?.querySelector('[aria-label="Outside the design system"]') ?? null;
    expect(dotOn("#ffffff")).not.toBeNull();
    expect(dotOn("primary")).toBeNull();
  });

  it("says so when the selection uses no colour", () => {
    showing([
      { children: [text("a")], id: "box", type: "column" },
    ] as DesignNode[]);
    act(() => select({ frame: HOME, nodeId: "box" }));
    expect(section()?.textContent).toContain("Nothing here sets a colour.");
  });

  it("changes every use of a colour, at its breakpoint and on an instance's layer, in one step", async () => {
    showing([
      {
        children: [
          { ...text("title"), at: { md: { color: "#fff" } } },
          {
            component: "Promo",
            from: "#app",
            id: "promo",
            overrides: { sale: { color: "#ffffff" } },
            type: "instance",
          },
        ],
        fill: "#ffffff",
        id: "card",
        type: "column",
      },
    ] as DesignNode[]);
    act(() => select({ frame: HOME, nodeId: "card" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    openField("#ffffff");
    pick("primary");
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [
            { id: "card", op: "update", set: { fill: "$color-primary" } },
            {
              at: "md",
              id: "title",
              op: "update",
              set: { color: "$color-primary" },
            },
            {
              id: "promo/sale",
              op: "update",
              set: { color: "$color-primary" },
            },
          ],
        },
      ],
      label: "Change a colour used",
    });
  });

  it("offers no Clear in a row's list", () => {
    showing([card()]);
    act(() => select({ frame: HOME, nodeId: "card" }));
    openField("#ffffff");
    expect(options().length).toBeGreaterThan(0);
    expect(options().some((o) => o.textContent === "Clear")).toBe(false);
  });

  /** A card whose fill and title are both the raw `#2563ea`, near primary. */
  const nearPrimary = () =>
    showing([
      {
        children: [{ ...text("title"), color: "#2563ea" }],
        fill: "#2563ea",
        id: "card",
        type: "column",
      },
    ] as DesignNode[]);

  it("puts every use on the nearest token by Use nearest", async () => {
    nearPrimary();
    act(() => select({ frame: HOME, nodeId: "card" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    openField("#2563ea");
    pick("Use nearest");
    await act(() => fakeApi.requested("documents.apply"));
    expect(applied()).toMatchObject({
      edits: [
        {
          ops: [
            { id: "card", set: { fill: "$color-primary" } },
            { id: "title", set: { color: "$color-primary" } },
          ],
        },
      ],
    });
  });

  it("makes a new token from a row's value and puts every use on it, in one edit", async () => {
    nearPrimary();
    act(() => select({ frame: HOME, nodeId: "card" }));
    fakeApi.respond("designSystem.edit", () => ({ changes: [], files: [] }));
    openField("#2563ea");
    pick("New token from this value…");
    const naming = document.querySelector<HTMLInputElement>(
      'input[aria-label="The new token\'s name"]'
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(naming, "color-brand");
      naming.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      naming.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
    });
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(
      fakeApi.calls.findLast((c) => c.method === "designSystem.edit")?.input
    ).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [
            { id: "card", op: "update", set: { fill: "$color-brand" } },
            { id: "title", op: "update", set: { color: "$color-brand" } },
          ],
        },
      ],
      label: "Change a colour used",
      ops: [{ name: "color-brand", op: "addToken", value: "#2563ea" }],
    });
  });

  it("stays current as the page changes, two colours made one becoming one row", () => {
    showing([card()]);
    act(() => select({ frame: HOME, nodeId: "card" }));
    act(() =>
      showing([
        {
          ...card(),
          children: [{ ...text("title"), color: "$color-primary" }],
          fill: "$color-primary",
        } as DesignNode,
      ])
    );
    expect(rows()).toEqual([["2 uses", "primary"]]);
  });
});

describe("a system component's own variant members (ADR 0161)", () => {
  const settle = () =>
    act(async () => {
      await Promise.resolve();
    });

  it("lists the members the product's look adds and its own axis in the Variant field, and none it takes out", async () => {
    const badge = {
      base: {},
      members: {
        shape: { add: ["default", "pill"] },
        variant: { add: ["neutral-strong"], remove: ["outline"] },
      },
      name: "Badge",
      origin: "system",
      states: {},
      variants: {},
      version: 1,
    } as const;
    useComponents.setState({
      catalogue: catalogueOf([badge]),
      components: [badge],
    });
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...home,
          root: {
            children: [
              {
                component: "Badge",
                from: "@ultrapaint/system",
                id: "beta",
                props: { variant: "neutral-strong" },
                text: "Beta",
                type: "instance",
              },
            ],
            id: "home",
            type: "page",
          } as DesignNode,
        },
      },
    });
    act(() => select({ frame: HOME, nodeId: "beta" }));
    expect(container.textContent).toContain("variant");
    expect(container.textContent).toContain("shape");
    const trigger = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-slot="select-trigger"]'
      ),
    ].find((t) => t.textContent?.includes("neutral-strong"));
    act(() => trigger?.click());
    await settle();
    expect(
      [...document.querySelectorAll('[role="option"]')].map(
        (o) => o.textContent
      )
    ).toEqual([
      "default",
      "secondary",
      "destructive",
      "warning",
      "success",
      "info",
      "neutral-strong",
      "Default",
    ]);
  });
});
