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
const IMAGE_RE = /url\(|gradient\(/;
const GRADIENT = "linear-gradient(in oklab, $color-primary, transparent)";

/** A page of boxes, each filled as given. */
const pageOf = (boxes: Record<string, string | undefined>): DocumentState => ({
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: Object.entries(boxes).map(([id, fill]) => ({
      children: [],
      id,
      type: "column",
      ...(fill !== undefined && { fill }),
    })),
    id: "home",
    type: "page",
  } as DesignNode,
});

const initialEditor = useEditor.getState();

let mounted: Root;
let container: HTMLElement;

const TABLET = `${HOME}#tablet`;

const show = (
  boxes: Record<string, string | undefined>,
  id = "box",
  frame = HOME
) => {
  act(() => useDocuments.setState({ docs: { [HOME]: pageOf(boxes) } }));
  act(() => select({ frame, nodeId: id }));
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

/** The Fill section's layer rows, by kind, the top one first. */
const rows = () =>
  [...container.querySelectorAll("[data-fill-layer]")].map((r) =>
    r.getAttribute("data-fill-layer")
  );

/** What the last edit set on each node it changed. */
const applied = () =>
  fakeApi.calls.findLast((c) => c.method === "documents.apply")?.input as
    | {
        edits: { ops: { id: string; set: Record<string, unknown> }[] }[];
        label: string;
      }
    | undefined;
const edits = () =>
  fakeApi.calls.filter((c) => c.method === "documents.apply").length;
/** The fields the last edit set, node by node. */
const fills = () => applied()?.edits.flatMap((e) => e.ops.map((op) => op.set));

/** The title of the popover open. */
const title = () =>
  document.querySelector('[data-slot="popover-title"]')?.textContent;

/** Presses a button inside the first element `selector` finds. */
const pressIn = (selector: string, label: string) => {
  const button = container
    .querySelector(selector)
    ?.querySelector(`button[aria-label="${label}"]`) as HTMLElement | null;
  if (!button) {
    throw new Error(`no ${label} in ${selector}`);
  }
  act(() => button.click());
};

/**
 * Opens the first layer's popover from its swatch, unless one is open, and lets it put the focus
 * in it.
 */
const openSwatch = async () => {
  const swatch = container.querySelector(
    "[data-layer-swatch]"
  ) as HTMLElement | null;
  if (!swatch) {
    throw new Error("no swatch");
  }
  if (title() === undefined) {
    act(() => swatch.click());
  }
  await act(async () => undefined);
};

/** Opens a field's list, as a click on it does. */
const activate = (input: Element) =>
  act(() => {
    input.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 })
    );
  });

/** Opens the list of the field named `name`. */
const openField = (name: string) => {
  const input = document.querySelector(`[aria-label="${name}"] input`);
  if (!input) {
    throw new Error(`no field ${name}`);
  }
  activate(input);
};

const press = (label: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label || b.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(`no button ${label}`);
  }
  act(() => button.click());
};

/** Types a value into the focused field. */
const type = (value: string) => {
  const input = document.activeElement as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** The option of the open list that offers `value`. */
const optionFor = (value: string) =>
  [...document.querySelectorAll("[role=option]")].find((o) =>
    o.textContent?.includes(value)
  ) as HTMLElement | undefined;

const offered = (value: string) => optionFor(value) !== undefined;

/** Types a value into the focused field and takes it. */
const typeAndTake = async (value: string) => {
  type(value);
  const option = optionFor(value);
  if (!option) {
    throw new Error(`nothing offers ${value}`);
  }
  await act(async () => option.click());
};

describe("the Fill section's layers (ADR 0134)", () => {
  it("lists a fill's layers, the top one first, each with a swatch drawing it", () => {
    useDesignSystem.setState({
      designSystem: {
        ...emptyDesignSystem(),
        colors: [
          {
            name: "Semantic",
            tokens: [{ name: "color-primary", value: "#123456" }],
          },
        ],
      },
    });
    show({ box: `${GRADIENT}, $color-card` });
    expect(rows()).toEqual(["gradient", "color"]);
    const swatch = container.querySelector(
      '[data-fill-layer="gradient"] [data-layer-swatch] span'
    );
    expect(swatch?.getAttribute("style")).toContain("linear-gradient");
    expect(swatch?.getAttribute("style")).toContain("#123456");
    expect(edits()).toBe(0);
  });

  it("opens a fill it cannot read as one row, left as it is", () => {
    show({ box: "url(hero.png) center / cover, $color-card" });
    expect(rows()).toEqual(["css"]);
    expect(edits()).toBe(0);
  });

  it("adds a colour layer on top with its colours open, as one edit", async () => {
    show({ box: GRADIENT });
    press("Add fill layer");
    expect(rows()).toEqual(["new", "gradient"]);
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
    await typeAndTake("$color-accent");
    await act(() => fakeApi.requested("documents.apply"));
    expect(edits()).toBe(1);
    expect(applied()?.edits[0]?.ops[0]?.set).toEqual({
      fill: `linear-gradient($color-accent, $color-accent), ${GRADIENT}`,
    });
  });

  it("marks a gradient off the system only where a stop is no token", () => {
    const dot = () =>
      container.querySelector(
        '[data-fill-layer="gradient"] [aria-label="Outside the design system"]'
      );
    show({ box: GRADIENT });
    expect(dot()).toBeNull();
    show({ box: "linear-gradient(in oklab, #ff0000, transparent)" });
    expect(dot()).not.toBeNull();
  });

  it("takes a layer off with its −, in one edit", () => {
    show({ box: `${GRADIENT}, $color-card` });
    pressIn('[data-fill-layer="gradient"]', "Remove fill layer");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([{ fill: "$color-card" }]);
  });

  it("takes the fill off with its last layer", () => {
    show({ box: "$color-card" });
    pressIn('[data-fill-layer="color"]', "Remove fill layer");
    expect(fills()).toEqual([{ fill: null }]);
  });

  it("opens a colour layer's popover from its swatch, titled for it, and turns the colour into a gradient in one edit, the popover kept open", async () => {
    show({ box: "$color-card" });
    await openSwatch();
    expect(title()).toBe("Colour");
    press("Gradient");
    act(() =>
      useDocuments.setState({
        docs: {
          [HOME]: pageOf({
            box: "linear-gradient(in oklab, $color-card, transparent)",
          }),
        },
      })
    );
    // The popover stays open on the layer, now a gradient.
    expect(title()).toBe("Linear gradient");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      { fill: "linear-gradient(in oklab, $color-card, transparent)" },
    ]);
  });

  it("sets a gradient's stop to a token in one edit, the fill rewritten", async () => {
    show({ box: "linear-gradient(in oklab, #ff0000, transparent)" });
    await openSwatch();
    expect(title()).toBe("Linear gradient");
    openField("Stop 1");
    await typeAndTake("$color-primary");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([{ fill: GRADIENT }]);
  });

  it("takes a colour for a stop and nothing else", async () => {
    // happy-dom takes any CSS; a browser takes no image for a colour.
    vi.stubGlobal("CSS", {
      supports: (property: string, value?: string) =>
        property !== "color" || !IMAGE_RE.test(value ?? ""),
    });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    show({ box: GRADIENT });
    await openSwatch();
    openField("Stop 1");
    await type("url(hero.png)");
    expect(offered("url(hero.png)")).toBe(false);
    await type("#00ff00");
    expect(offered("#00ff00")).toBe(true);
  });

  it("sets a gradient's angle in one edit", async () => {
    show({ box: GRADIENT });
    await openSwatch();
    openField("Angle");
    await typeAndTake("45");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      { fill: "linear-gradient(45deg in oklab, $color-primary, transparent)" },
    ]);
  });

  it("sets a gradient's shape in one edit", async () => {
    show({ box: GRADIENT });
    await openSwatch();
    press("Radial");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      { fill: "radial-gradient(in oklab, $color-primary, transparent)" },
    ]);
  });

  it("adds a stop where the bar is pressed, in one edit", async () => {
    show({ box: GRADIENT });
    await openSwatch();
    const bar = document.querySelector("[data-stop-bar]") as HTMLElement;
    bar.getBoundingClientRect = () =>
      ({ height: 24, left: 0, top: 0, width: 200 }) as DOMRect;
    act(() => {
      bar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100 })
      );
    });
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      {
        fill: "linear-gradient(in oklab, $color-primary, $color-primary 50%, transparent)",
      },
    ]);
  });

  it("moves a stop where it is let go, in one edit", async () => {
    show({ box: GRADIENT });
    await openSwatch();
    const bar = document.querySelector("[data-stop-bar]") as HTMLElement;
    bar.getBoundingClientRect = () =>
      ({ height: 24, left: 0, top: 0, width: 200 }) as DOMRect;
    const stop = document.querySelector('[data-stop="0"]') as HTMLElement;
    for (const [event, clientX] of [
      ["pointerdown", 0],
      ["pointermove", 20],
      ["pointermove", 40],
      ["pointerup", 40],
    ] as const) {
      act(() => {
        stop.dispatchEvent(new PointerEvent(event, { bubbles: true, clientX }));
      });
    }
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      { fill: "linear-gradient(in oklab, $color-primary 20%, transparent)" },
    ]);
  });

  it("takes a stop off, the others left where they are drawn", async () => {
    show({
      box: "linear-gradient(in oklab, $color-primary, $color-accent, transparent)",
    });
    await openSwatch();
    press("Remove stop");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      { fill: "linear-gradient(in oklab, $color-accent 50%, transparent)" },
    ]);
  });

  it("reads Mixed for boxes whose fills differ, and gives them all a gradient set there", async () => {
    show({ a: GRADIENT, b: "$color-card" }, "a");
    act(() => toggleSelected({ frame: HOME, nodeId: "b" }));
    expect(rows()).toEqual([]);
    const field = [...container.querySelectorAll("input")].find(
      (i) => i.value === "Mixed"
    );
    if (!field) {
      throw new Error("no field reads Mixed");
    }
    activate(field);
    await typeAndTake("linear-gradient(red, blue)");
    expect(fills()).toEqual([
      { fill: "linear-gradient(red, blue)" },
      { fill: "linear-gradient(red, blue)" },
    ]);
  });

  it("writes a layer edited in a view at the view's breakpoint (ADR 0036)", () => {
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
    show({ box: `${GRADIENT}, $color-card` }, "box", TABLET);
    pressIn('[data-fill-layer="gradient"]', "Remove fill layer");
    expect(applied()?.edits[0]?.ops).toEqual([
      { at: "md", id: "box", op: "update", set: { fill: "$color-card" } },
    ]);
  });

  it("writes a layer of an app component's instance as the instance's override (ADR 0114)", () => {
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
                fill: `${GRADIENT}, $color-card`,
                id: "box",
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
    expect(rows()).toEqual(["gradient", "color"]);
    pressIn('[data-fill-layer="gradient"]', "Remove fill layer");
    expect(applied()?.edits).toEqual([
      {
        doc: HOME,
        ops: [{ id: "promo/box", op: "update", set: { fill: "$color-card" } }],
      },
    ]);
  });
});
