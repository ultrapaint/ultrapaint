// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
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
const TABLET = `${HOME}#tablet`;
const RING = "inset 0 0 0 1px rgba(0,0,0,.1)";

/** A page of boxes, each with the fields given. */
const pageWith = (boxes: Record<string, object>): DocumentState => ({
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: Object.entries(boxes).map(([id, fields]) => ({
      children: [],
      id,
      type: "column",
      ...fields,
    })),
    id: "home",
    type: "page",
  } as DesignNode,
});

/** A page of boxes, each with the shadow given. */
const pageOf = (boxes: Record<string, string | undefined>): DocumentState =>
  pageWith(
    Object.fromEntries(
      Object.entries(boxes).map(([id, shadow]) => [
        id,
        shadow === undefined ? {} : { shadow },
      ])
    )
  );

const initialEditor = useEditor.getState();

let mounted: Root;
let container: HTMLElement;

const show = (
  boxes: Record<string, string | undefined>,
  id = "box",
  frame = HOME
) => {
  act(() => useDocuments.setState({ docs: { [HOME]: pageOf(boxes) } }));
  act(() => select({ frame, nodeId: id }));
};

/** Shows a page of boxes with the fields given, the first selected. */
const showWith = (boxes: Record<string, object>, frame = HOME) => {
  act(() => useDocuments.setState({ docs: { [HOME]: pageWith(boxes) } }));
  act(() => select({ frame, nodeId: Object.keys(boxes)[0] ?? "" }));
};

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
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
  useComponents.setState({ components: [] });
  useDesignSystem.setState({ designSystem: null });
  useEditor.setState(initialEditor, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  editFrameAs(null);
  useIsolation.setState({ isolated: null });
  useDocuments.setState({ canvas: "main", docs: {} });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<Inspector />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
});

/** The Effects section's shadow rows, each as its field reads, the top one first. */
const rows = () =>
  [...container.querySelectorAll("[data-shadow]")].map(
    (r) => (r.querySelector("input") as HTMLInputElement | null)?.value ?? ""
  );

/** What the last edit asked the server for. */
const applied = () =>
  fakeApi.calls.findLast((c) => c.method === "documents.apply")?.input as
    | {
        edits: {
          doc: string;
          ops: { id: string; set: Record<string, unknown> }[];
        }[];
        label: string;
      }
    | undefined;
const edits = () =>
  fakeApi.calls.filter((c) => c.method === "documents.apply").length;
/** The fields the last edit set, node by node. */
const sets = () => applied()?.edits.flatMap((e) => e.ops.map((op) => op.set));

/** Presses the button labelled `label` in the shadow row numbered `n`, from 1. */
const pressInRow = (n: number, label: string) => {
  const button = container
    .querySelectorAll("[data-shadow]")
    [n - 1]?.querySelector(
      `button[aria-label="${label}"]`
    ) as HTMLElement | null;
  if (!button) {
    throw new Error(`no ${label} in row ${n}`);
  }
  act(() => button.click());
};

const press = (label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
  if (!button) {
    throw new Error(`no button ${label}`);
  }
  act(() => button.click());
};

/** The Effects section's + menu, opened: its items' names. */
const effectsMenu = () => {
  press("Add effect");
  return [...document.querySelectorAll("[role=menuitem]")].map(
    (i) => i.textContent
  );
};

/** Adds an effect from the Effects section's + menu. */
const addEffect = (name: string) => {
  press("Add effect");
  const item = [...document.querySelectorAll("[role=menuitem]")].find(
    (i) => i.textContent === name
  ) as HTMLElement | undefined;
  if (!item) {
    throw new Error(`no ${name} in the menu`);
  }
  act(() => item.click());
};

/** Opens a field's list, as a click on it does. */
const activate = (input: Element) =>
  act(() => {
    input.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 })
    );
  });

/** Opens the list of the shadow row numbered `n`, from 1. */
const openRow = (n: number) => {
  const input = container
    .querySelectorAll("[data-shadow]")
    [n - 1]?.querySelector("input");
  if (!input) {
    throw new Error(`no row ${n}`);
  }
  activate(input);
};

/** Types a value into the focused field and takes it. */
const typeAndTake = async (value: string) => {
  const input = document.activeElement as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const option = [...document.querySelectorAll("[role=option]")].find((o) =>
    o.textContent?.includes(value)
  ) as HTMLElement | undefined;
  if (!option) {
    throw new Error(`nothing offers ${value}`);
  }
  await act(async () => option.click());
};

describe("the Effects section's shadows", () => {
  it("shows a row per shadow, the one drawn on top first", () => {
    show({ box: `$shadow-md, ${RING}` });
    expect(rows()).toEqual(["shadow-md", RING]);
  });

  it("shows one shadow, a token or CSS, as one row", () => {
    show({ box: "$shadow-md" });
    expect(rows()).toEqual(["shadow-md"]);
    show({ box: "0 1px 2px rgba(0, 0, 0, 0.1)" });
    expect(rows()).toEqual(["0 1px 2px rgba(0, 0, 0, 0.1)"]);
  });

  it("adds a shadow after the others with its list open, in one edit", async () => {
    show({ box: "$shadow-md" });
    addEffect("Shadow");
    expect(rows()).toEqual(["shadow-md", ""]);
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
    await typeAndTake(RING);
    expect(edits()).toBe(1);
    expect(sets()).toEqual([{ shadow: `$shadow-md, ${RING}` }]);
  });

  it("takes one shadow off with its −, the others kept, in one edit", () => {
    show({ box: `$shadow-md, ${RING}` });
    pressInRow(1, "Remove shadow");
    expect(edits()).toBe(1);
    expect(sets()).toEqual([{ shadow: RING }]);
  });

  it("takes the field off with its last shadow", () => {
    show({ box: RING });
    pressInRow(1, "Remove shadow");
    expect(sets()).toEqual([{ shadow: null }]);
  });

  it("changes one shadow of the list in one edit, the others kept", async () => {
    show({ box: `$shadow-md, ${RING}` });
    openRow(2);
    await typeAndTake("inset 0 1px 0 #fff");
    expect(edits()).toBe(1);
    expect(sets()).toEqual([{ shadow: "$shadow-md, inset 0 1px 0 #fff" }]);
  });

  it("marks a raw shadow off the system, and a token not", () => {
    show({ box: `$shadow-md, ${RING}` });
    const dots = [...container.querySelectorAll("[data-shadow]")].map(
      (r) =>
        r.querySelector('[aria-label="Outside the design system"]') !== null
    );
    expect(dots).toEqual([false, true]);
  });

  it("reads Mixed for boxes whose shadows differ, and gives them all the list set there", async () => {
    show({ a: `$shadow-md, ${RING}`, b: "$shadow-md" }, "a");
    act(() => toggleSelected({ frame: HOME, nodeId: "b" }));
    expect(rows()).toEqual(["Mixed"]);
    openRow(1);
    await typeAndTake(`$shadow-lg, ${RING}`);
    const ops = applied()?.edits.flatMap((e) => e.ops) ?? [];
    expect(
      ops
        .map((op) => [op.id, op.set])
        .sort(([x], [y]) => String(x).localeCompare(String(y)))
    ).toEqual([
      ["a", { shadow: `$shadow-lg, ${RING}` }],
      ["b", { shadow: `$shadow-lg, ${RING}` }],
    ]);
  });

  it("takes the shadows off boxes whose shadows differ with the row's −", () => {
    show({ a: `$shadow-md, ${RING}`, b: "$shadow-md" }, "a");
    act(() => toggleSelected({ frame: HOME, nodeId: "b" }));
    pressInRow(1, "Remove shadow");
    expect(edits()).toBe(1);
    expect(sets()).toEqual([{ shadow: null }, { shadow: null }]);
  });

  it("writes a shadow edited in a view at the view's breakpoint (ADR 0036)", () => {
    useEditor.setState({
      frames: {
        [HOME]: {
          height: 900,
          preset: "desktop",
          views: [{ height: 900, id: "tablet", width: 800, x: 1600, y: 0 }],
          width: 1440,
          x: 0,
          y: 0,
        },
        [TABLET]: { height: 900, preset: "custom", width: 800, x: 1600, y: 0 },
      },
    });
    show({ box: `$shadow-md, ${RING}` }, "box", TABLET);
    pressInRow(2, "Remove shadow");
    expect(applied()?.edits[0]?.ops).toEqual([
      { at: "md", id: "box", op: "update", set: { shadow: "$shadow-md" } },
    ]);
  });

  it("writes a shadow of an app component's instance as the instance's override (ADR 0114)", () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [
              {
                children: [],
                id: "box",
                shadow: `$shadow-md, ${RING}`,
                type: "column",
              },
            ],
            id: "p-root",
            type: "column",
          },
          version: 1,
        },
      ] as never,
    });
    act(() =>
      useDocuments.setState({
        docs: {
          [HOME]: {
            ...pageOf({}),
            root: {
              children: [
                {
                  component: "Promo",
                  from: "#app",
                  id: "promo",
                  type: "instance",
                },
              ],
              id: "home",
              type: "page",
            } as DesignNode,
          },
        },
      })
    );
    act(() => select({ frame: HOME, nodeId: "promo/box" }));
    expect(rows()).toEqual(["shadow-md", RING]);
    pressInRow(1, "Remove shadow");
    expect(applied()?.edits).toEqual([
      {
        doc: HOME,
        ops: [{ id: "promo/box", op: "update", set: { shadow: RING } }],
      },
    ]);
  });

  it("takes a list typed in one row, a token among raw shadows", async () => {
    // happy-dom takes any CSS; a browser refuses `$`.
    vi.stubGlobal("CSS", {
      supports: (_property: string, value?: string) => !value?.includes("$"),
    });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    show({ box: "$shadow-md" });
    addEffect("Shadow");
    await typeAndTake("0 1px 2px #000, $shadow-lg");
    expect(sets()).toEqual([
      { shadow: "$shadow-md, 0 1px 2px #000, $shadow-lg" },
    ]);
  });

  it("puts a shadow added to a box whose shadow is none in its place", async () => {
    show({ box: "none" });
    addEffect("Shadow");
    await typeAndTake(RING);
    expect(sets()).toEqual([{ shadow: RING }]);
  });

  it("closes a new token's naming when the shadow it is for leaves its place", () => {
    const naming = () =>
      document.querySelector('input[aria-label="The new token\'s name"]');
    useDesignSystem.setState({ designSystem: emptyDesignSystem() });
    show({ box: `0 1px 2px #000, ${RING}, inset 0 1px 0 #fff` });
    openRow(2);
    const newToken = [...document.querySelectorAll("[role=option]")].find(
      (o) => o.textContent === "New token from this value…"
    ) as HTMLElement | undefined;
    if (!newToken) {
      throw new Error("no New token");
    }
    act(() => newToken.click());
    expect(naming()).not.toBeNull();
    show({ box: `${RING}, inset 0 1px 0 #fff` });
    expect(naming()).toBeNull();
  });

  it("offers no whole-value keyword as one shadow of a list typed", () => {
    show({ box: "$shadow-md" });
    addEffect("Shadow");
    const input = document.activeElement as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, "inherit, 0 1px 2px #000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const offered = [...document.querySelectorAll("[role=option]")].some((o) =>
      o.textContent?.includes("inherit, 0 1px 2px #000")
    );
    expect(offered).toBe(false);
  });

  it("writes no whole-value keyword picked in a row beside other shadows", async () => {
    show({ box: "$shadow-md" });
    addEffect("Shadow");
    await typeAndTake("none");
    expect(sets()).toEqual([{ shadow: "$shadow-md" }]);
  });

  it("closes a new token's naming when its shadow goes, one the same as it left", () => {
    const naming = () =>
      document.querySelector('input[aria-label="The new token\'s name"]');
    useDesignSystem.setState({ designSystem: emptyDesignSystem() });
    show({ box: `${RING}, ${RING}` });
    openRow(1);
    const newToken = [...document.querySelectorAll("[role=option]")].find(
      (o) => o.textContent === "New token from this value…"
    ) as HTMLElement | undefined;
    if (!newToken) {
      throw new Error("no New token");
    }
    act(() => newToken.click());
    expect(naming()).not.toBeNull();
    show({ box: RING });
    expect(naming()).toBeNull();
  });
});

describe("the Effects section's blur behind", () => {
  const BLURS = {
    ...emptyDesignSystem(),
    blurs: [
      { name: "blur-glass", value: "6px" },
      { name: "blur-md", value: "12px" },
    ],
  };
  /** The Blur behind row's field, as it reads; null without the row. */
  const blurRow = () =>
    (container.querySelector("[data-blur] input") as HTMLInputElement | null)
      ?.value ?? null;
  /** The options the open list offers, each its name, its value and its token. */
  const offered = () =>
    [...document.querySelectorAll("[role=option]")].map((o) => o.textContent);
  /** Picks the option whose name is `name` from the open list. */
  const pick = async (name: string) => {
    const option = [...document.querySelectorAll("[role=option]")].find((o) =>
      o.textContent?.startsWith(name)
    ) as HTMLElement | undefined;
    if (!option) {
      throw new Error(`nothing offers ${name}`);
    }
    await act(async () => option.click());
  };

  it("is added from the +, its list open on the design system's blurs, and a pick sets it in one edit", async () => {
    useDesignSystem.setState({ designSystem: BLURS });
    showWith({ box: {} });
    expect(blurRow()).toBeNull();
    addEffect("Blur behind");
    expect(blurRow()).toBe("");
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
    expect(offered()).toEqual(
      expect.arrayContaining(["glass6px$blur-glass", "md12px$blur-md"])
    );
    await pick("md");
    expect(edits()).toBe(1);
    expect(sets()).toEqual([{ backdropBlur: "$blur-md" }]);
  });

  it("offers Tailwind's seven blurs where the design system lists none, or there is none", () => {
    const tailwind = [
      ["xs", "4px"],
      ["sm", "8px"],
      ["md", "12px"],
      ["lg", "16px"],
      ["xl", "24px"],
      ["2xl", "40px"],
      ["3xl", "64px"],
    ].map(([step, px]) => `${step}${px}$blur-${step}`);
    for (const designSystem of [null, emptyDesignSystem()]) {
      useDesignSystem.setState({ designSystem });
      showWith({ box: { backdropBlur: "$blur-md" } });
      const input = container.querySelector("[data-blur] input");
      if (!input) {
        throw new Error("no Blur behind row");
      }
      activate(input);
      expect(offered().filter((o) => tailwind.includes(o ?? ""))).toEqual(
        tailwind
      );
    }
  });

  it("takes a length typed as pixels", async () => {
    useDesignSystem.setState({ designSystem: BLURS });
    showWith({ box: {} });
    addEffect("Blur behind");
    await typeAndTake("10px");
    expect(sets()).toEqual([{ backdropBlur: 10 }]);
  });

  it("marks a raw blur off the system, and a token not", () => {
    useDesignSystem.setState({ designSystem: BLURS });
    const dot = () =>
      container.querySelector(
        '[data-blur] [aria-label="Outside the design system"]'
      ) !== null;
    showWith({ box: { backdropBlur: 10 } });
    expect(blurRow()).toBe("10");
    expect(dot()).toBe(true);
    showWith({ box: { backdropBlur: "$blur-md" } });
    expect(dot()).toBe(false);
  });

  it("takes the blur off with its −", () => {
    showWith({ box: { backdropBlur: "$blur-md" } });
    const remove = container.querySelector(
      '[data-blur] button[aria-label="Remove blur behind"]'
    ) as HTMLElement | null;
    if (!remove) {
      throw new Error("no −");
    }
    act(() => remove.click());
    expect(edits()).toBe(1);
    expect(sets()).toEqual([{ backdropBlur: null }]);
  });

  it("is offered by the + until it is shown, beside a shadow, which a box can always add", () => {
    showWith({ box: { shadow: "$shadow-md" } });
    expect(effectsMenu()).toEqual(["Shadow", "Blur behind"]);
    showWith({ box: { backdropBlur: "$blur-md", shadow: "$shadow-md" } });
    expect(effectsMenu()).toEqual(["Shadow"]);
  });

  it("reads Mixed for boxes whose blurs differ, and gives them all the one set there", async () => {
    useDesignSystem.setState({ designSystem: BLURS });
    showWith({ a: { backdropBlur: "$blur-md" }, b: { backdropBlur: 10 } });
    act(() => toggleSelected({ frame: HOME, nodeId: "b" }));
    expect(blurRow()).toBe("Mixed");
    const input = container.querySelector("[data-blur] input");
    if (!input) {
      throw new Error("no Blur behind row");
    }
    activate(input);
    await pick("glass");
    const ops = applied()?.edits.flatMap((e) => e.ops) ?? [];
    expect(
      ops
        .map((op) => [op.id, op.set])
        .sort(([x], [y]) => String(x).localeCompare(String(y)))
    ).toEqual([
      ["a", { backdropBlur: "$blur-glass" }],
      ["b", { backdropBlur: "$blur-glass" }],
    ]);
  });

  it("writes a blur set in a view at the view's breakpoint (ADR 0036)", () => {
    useEditor.setState({
      frames: {
        [HOME]: {
          height: 900,
          preset: "desktop",
          views: [{ height: 900, id: "tablet", width: 800, x: 1600, y: 0 }],
          width: 1440,
          x: 0,
          y: 0,
        },
        [TABLET]: { height: 900, preset: "custom", width: 800, x: 1600, y: 0 },
      },
    });
    showWith({ box: { backdropBlur: "$blur-md" } }, TABLET);
    const remove = container.querySelector(
      '[data-blur] button[aria-label="Remove blur behind"]'
    ) as HTMLElement | null;
    act(() => remove?.click());
    expect(applied()?.edits[0]?.ops).toEqual([
      { at: "md", id: "box", op: "update", set: { backdropBlur: null } },
    ]);
  });

  it("writes a blur of an app component's instance as the instance's override (ADR 0114)", async () => {
    useDesignSystem.setState({ designSystem: BLURS });
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [{ children: [], id: "box", type: "column" }],
            id: "p-root",
            type: "column",
          },
          version: 1,
        },
      ] as never,
    });
    act(() =>
      useDocuments.setState({
        docs: {
          [HOME]: {
            ...pageOf({}),
            root: {
              children: [
                {
                  component: "Promo",
                  from: "#app",
                  id: "promo",
                  type: "instance",
                },
              ],
              id: "home",
              type: "page",
            } as DesignNode,
          },
        },
      })
    );
    act(() => select({ frame: HOME, nodeId: "promo/box" }));
    addEffect("Blur behind");
    await pick("md");
    expect(applied()?.edits).toEqual([
      {
        doc: HOME,
        ops: [
          { id: "promo/box", op: "update", set: { backdropBlur: "$blur-md" } },
        ],
      },
    ]);
  });
});
