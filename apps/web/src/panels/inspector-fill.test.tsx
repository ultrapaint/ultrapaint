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
/** A fill of the image node's placeholder picture, at Cover. */
const PLACEHOLDER_FILL_RE =
  /^url\(data:image\/svg\+xml;utf8,.*\) center \/ cover no-repeat$/;
const IMAGE_RE = /url\(|gradient\(/;
const CONIC =
  "conic-gradient(in oklab, $color-primary 0deg, $color-accent 90deg, transparent 180deg)";
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

/** Presses the remove button of the stop numbered `n`, from 1. */
const removeStop = (n: number) => {
  const remove = [...document.querySelectorAll("button")].filter(
    (b) => b.getAttribute("aria-label") === "Remove stop"
  )[n - 1];
  if (!remove) {
    throw new Error(`no stop ${n}`);
  }
  act(() => remove.click());
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
    // A picture tiled at a fit of contain is none the editor offers (ADR 0149).
    show({ box: "url(hero.png) center / contain, $color-card" });
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

  it("adds a stop with its button, in the widest room between two, in one edit", async () => {
    show({
      box: "linear-gradient(in oklab, $color-primary, $color-accent 20%, transparent)",
    });
    await openSwatch();
    press("Add stop");
    expect(edits()).toBe(1);
    expect(fills()).toEqual([
      {
        fill: "linear-gradient(in oklab, $color-primary, $color-accent 20%, $color-accent 60%, transparent)",
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

  it("forgets a drag the browser cancels, a stop then moved by the keys from where it is", async () => {
    show({ box: GRADIENT });
    await openSwatch();
    const bar = document.querySelector("[data-stop-bar]") as HTMLElement;
    bar.getBoundingClientRect = () =>
      ({ height: 24, left: 0, top: 0, width: 200 }) as DOMRect;
    const stop = document.querySelector('[data-stop="0"]') as HTMLElement;
    for (const [event, clientX] of [
      ["pointerdown", 0],
      ["pointermove", 40],
      ["pointercancel", 40],
    ] as const) {
      act(() => {
        stop.dispatchEvent(new PointerEvent(event, { bubbles: true, clientX }));
      });
    }
    expect(edits()).toBe(0);
    act(() => {
      stop.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })
      );
    });
    expect(fills()).toEqual([
      { fill: "linear-gradient(in oklab, $color-primary 1%, transparent)" },
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

  it("keeps stops placed in a length where they are written, the bar moving none", async () => {
    show({
      box: "linear-gradient(in oklab, $color-primary 10px, $color-accent, transparent)",
    });
    await openSwatch();
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(0);
    const bar = document.querySelector("[data-stop-bar]") as HTMLElement;
    bar.getBoundingClientRect = () =>
      ({ height: 24, left: 0, top: 0, width: 200 }) as DOMRect;
    act(() => {
      bar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100 })
      );
    });
    expect(edits()).toBe(0);
  });

  it("takes a stop off a gradient placed in a length, the others as written", async () => {
    show({
      box: "linear-gradient(in oklab, $color-primary 10px, $color-accent, transparent)",
    });
    await openSwatch();
    removeStop(2);
    expect(fills()).toEqual([
      { fill: "linear-gradient(in oklab, $color-primary 10px, transparent)" },
    ]);
  });

  it("places a conic gradient's angles as their share of the turn when a stop is taken off", async () => {
    show({ box: CONIC });
    await openSwatch();
    removeStop(1);
    expect(fills()).toEqual([
      { fill: "conic-gradient(in oklab, $color-accent 25%, transparent 50%)" },
    ]);
  });

  it("keeps stops placed in a length from linear to radial, which both take", async () => {
    show({
      box: "linear-gradient(in oklab, $color-primary 10px, $color-accent 40%, transparent 80%)",
    });
    await openSwatch();
    press("Radial");
    expect(fills()).toEqual([
      {
        fill: "radial-gradient(in oklab, $color-primary 10px, $color-accent 40%, transparent 80%)",
      },
    ]);
  });

  it("keeps the percentages and drops only the lengths when a gradient turns conic", async () => {
    show({
      box: "linear-gradient(in oklab, $color-primary 10px, $color-accent 40%, transparent 80%)",
    });
    await openSwatch();
    press("Conic");
    expect(fills()).toEqual([
      {
        fill: "conic-gradient(from 180deg in oklab, $color-primary, $color-accent 40%, transparent 80%)",
      },
    ]);
  });

  it("takes a gradient of tokens typed into a colour's row, as the browser takes it with values", async () => {
    // A browser refuses `$`; the field asks it with the tokens stood in for.
    vi.stubGlobal("CSS", {
      supports: (_property: string, value?: string) => !value?.includes("$"),
    });
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    show({ box: "$color-card" });
    openField("Colour");
    await typeAndTake("linear-gradient($color-primary, transparent)");
    expect(fills()).toEqual([
      { fill: "linear-gradient($color-primary, transparent)" },
    ]);
  });

  it("gives a conic gradient's angles to another shape as their share of the turn", async () => {
    show({ box: CONIC });
    await openSwatch();
    press("Linear");
    expect(fills()).toEqual([
      {
        fill: "linear-gradient(0deg in oklab, $color-primary, $color-accent 25%, transparent 50%)",
      },
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
    const ops = applied()?.edits.flatMap((e) => e.ops) ?? [];
    expect(
      ops
        .map((op) => [op.id, op.set])
        .sort(([x], [y]) => String(x).localeCompare(String(y)))
    ).toEqual([
      ["a", { fill: "linear-gradient(red, blue)" }],
      ["b", { fill: "linear-gradient(red, blue)" }],
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

describe("an image layer of the Fill section (ADR 0149)", () => {
  const HERO = "url(assets/hero.png) center / cover no-repeat";
  const dotIn = (kind: string) =>
    container.querySelector(
      `[data-fill-layer="${kind}"] [aria-label="Outside the design system"]`
    );

  /** Chooses `file` in the open popover's file input, and waits for its upload and edit. */
  const choose = async (file: File) => {
    const input = document.querySelector(
      "[data-fill-file] input[type=file]"
    ) as HTMLInputElement | null;
    if (!input) {
      throw new Error("no file input");
    }
    Object.defineProperty(input, "files", { value: [file] });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => fakeApi.requested("documents.apply"));
  };

  it("lists an image with a swatch drawing its picture from where the canvas finds it, and no off-system dot where a raw colour beside it has one", () => {
    show({ box: `${HERO}, #ff0000` });
    expect(rows()).toEqual(["image", "color"]);
    const swatch = container.querySelector(
      '[data-fill-layer="image"] [data-layer-swatch] span'
    );
    expect(swatch?.getAttribute("style")).toContain("canvas=main");
    expect(swatch?.getAttribute("style")).toContain("src=assets%2Fhero.png");
    expect(dotIn("image")).toBeNull();
    expect(dotIn("color")).not.toBeNull();
    expect(edits()).toBe(0);
  });

  it("opens an image written alone as an image layer, writing nothing", () => {
    show({ box: 'url("assets/hero.png")' });
    expect(rows()).toEqual(["image"]);
    expect(edits()).toBe(0);
  });

  it("turns a colour into a picture with Kind, in one edit, the popover kept open on it", async () => {
    show({ box: "$color-card" });
    await openSwatch();
    press("Image");
    expect(edits()).toBe(1);
    const [set] = fills() ?? [];
    expect(String(set?.fill)).toMatch(PLACEHOLDER_FILL_RE);
    act(() =>
      useDocuments.setState({
        docs: { [HOME]: pageOf({ box: String(set?.fill) }) },
      })
    );
    expect(title()).toBe("Image");
    expect(rows()).toEqual(["image"]);
  });

  it("uploads its file into the canvas's assets, then sets its fit, each in one edit", async () => {
    fakeApi.respond("assets.upload", () => ({ src: "assets/photo.png" }));
    show({ box: `${HERO}, $color-card` });
    await openSwatch();
    expect(title()).toBe("Image");
    await choose(new File(["png"], "photo.png", { type: "image/png" }));
    expect(
      fakeApi.calls.find((c) => c.method === "assets.upload")?.input
    ).toMatchObject({ name: "photo.png" });
    expect(edits()).toBe(1);
    const uploaded =
      "url(assets/photo.png) center / cover no-repeat, $color-card";
    expect(fills()).toEqual([{ fill: uploaded }]);
    act(() =>
      useDocuments.setState({ docs: { [HOME]: pageOf({ box: uploaded }) } })
    );
    press("Contain");
    expect(edits()).toBe(2);
    expect(fills()).toEqual([
      { fill: "url(assets/photo.png) center / contain no-repeat, $color-card" },
    ]);
  });

  it("keeps a fit picked while its file uploads, the file then set over it", async () => {
    let finish: (out: { src: string }) => void = () => undefined;
    fakeApi.respond(
      "assets.upload",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    show({ box: HERO });
    await openSwatch();
    const input = document.querySelector(
      "[data-fill-file] input[type=file]"
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["png"], "photo.png", { type: "image/png" })],
    });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => fakeApi.requested("assets.upload"));
    press("Contain");
    const contained = "url(assets/hero.png) center / contain no-repeat";
    expect(fills()).toEqual([{ fill: contained }]);
    act(() =>
      useDocuments.setState({ docs: { [HOME]: pageOf({ box: contained }) } })
    );
    await act(async () => finish({ src: "assets/photo.png" }));
    expect(fills()).toEqual([
      { fill: "url(assets/photo.png) center / contain no-repeat" },
    ]);
  });

  /** Uploads answered as the test settles them, the first asked first in the list. */
  const pendingUploads = () => {
    const finishes: ((out: { src: string }) => void)[] = [];
    fakeApi.respond(
      "assets.upload",
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        })
    );
    return finishes;
  };

  /** Chooses `name` in the open popover's file input, its upload left pending. */
  const startUpload = async (name: string, count: number) => {
    const input = document.querySelector(
      "[data-fill-file] input[type=file]"
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["png"], name, { type: "image/png" })],
    });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => fakeApi.requested("assets.upload", count));
  };

  it("drops a file that arrives after the layer was made another kind", async () => {
    const finishes = pendingUploads();
    show({ box: HERO });
    await openSwatch();
    await startUpload("photo.png", 1);
    press("Gradient");
    const gradient = "linear-gradient(in oklab, transparent, transparent)";
    expect(fills()).toEqual([{ fill: gradient }]);
    act(() =>
      useDocuments.setState({ docs: { [HOME]: pageOf({ box: gradient }) } })
    );
    await act(async () => finishes[0]?.({ src: "assets/photo.png" }));
    expect(edits()).toBe(1);
  });

  it("gives no other layer that slid into its row the file uploaded for one taken off", async () => {
    const finishes = pendingUploads();
    const b = "url(assets/b.png) center / cover no-repeat";
    show({ box: `${HERO}, ${b}` });
    await openSwatch();
    await startUpload("photo.png", 1);
    // The first layer is taken off elsewhere: the second slides into its row.
    act(() => useDocuments.setState({ docs: { [HOME]: pageOf({ box: b }) } }));
    await act(async () => finishes[0]?.({ src: "assets/photo.png" }));
    expect(edits()).toBe(0);
  });

  it("sets the file chosen last, whichever upload ends first", async () => {
    const finishes = pendingUploads();
    show({ box: HERO });
    await openSwatch();
    await startUpload("first.png", 1);
    await startUpload("second.png", 2);
    await act(async () => finishes[1]?.({ src: "assets/second.png" }));
    const second = "url(assets/second.png) center / cover no-repeat";
    expect(fills()).toEqual([{ fill: second }]);
    act(() =>
      useDocuments.setState({ docs: { [HOME]: pageOf({ box: second }) } })
    );
    await act(async () => finishes[0]?.({ src: "assets/first.png" }));
    expect(edits()).toBe(1);
  });

  it("writes its fit on a layer of an app component's instance as the instance's override (ADR 0114)", async () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [{ children: [], fill: HERO, id: "box", type: "column" }],
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
    expect(rows()).toEqual(["image"]);
    await openSwatch();
    press("Contain");
    expect(applied()?.edits).toEqual([
      {
        doc: HOME,
        ops: [
          {
            id: "promo/box",
            op: "update",
            set: { fill: "url(assets/hero.png) center / contain no-repeat" },
          },
        ],
      },
    ]);
  });

  it("writes its fit set in a view at the view's breakpoint (ADR 0036)", async () => {
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
    show({ box: HERO }, "box", TABLET);
    await openSwatch();
    press("Contain");
    expect(applied()?.edits[0]?.ops).toEqual([
      {
        at: "md",
        id: "box",
        op: "update",
        set: { fill: "url(assets/hero.png) center / contain no-repeat" },
      },
    ]);
  });
});
