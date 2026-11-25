// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { editFrameAs, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { select } from "../state/selection.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Inspector } from "./inspector.tsx";
import { LookInspector } from "./look-inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";

/** Shades of a palette, each its own grey: `#000000`, `#111111`, …. */
const palette = (name: string, prefix: string, steps: readonly number[]) => ({
  name,
  tokens: steps.map((step, i) => ({
    name: `color-${prefix}-${step}`,
    value: `#${String(i).repeat(6)}`,
  })),
});

const ALL_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** The semantic colours, Blue with every step, Red with no 100, 400 or 500. */
const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#2563eb" },
        { name: "color-background", value: "#ffffff" },
      ],
    },
    palette("Blue", "blue", ALL_STEPS),
    palette(
      "Red",
      "red",
      ALL_STEPS.filter((s) => s !== 100 && s !== 400 && s !== 500)
    ),
  ],
};

const homeWith = (children: readonly DesignNode[]) => ({
  doc: HOME,
  hash: `${HOME}@0`,
  root: { children, id: "home", type: "page" } as DesignNode,
});

const initialEditor = useEditor.getState();
const initialBoard = useBoard.getState();
let mounted: Root;
let container: HTMLElement;

/** The design system, and a page of the nodes given, the first of them selected. */
const showing = (
  children: readonly DesignNode[],
  designSystem: DesignSystem = ds
) => {
  useDesignSystem.setState({ designSystem, saved: designSystem });
  useDocuments.setState({
    canvas: "main",
    docs: { [HOME]: homeWith(children) },
  });
  act(() => select({ frame: HOME, nodeId: children[0]?.id ?? "" }));
};

const box = (fill: string): DesignNode =>
  ({ children: [], fill, id: "box", type: "group" }) as DesignNode;

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
  useComponents.setState({ components: [] });
  useEditor.setState(initialEditor, true);
  useBoard.setState(initialBoard, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  editFrameAs(null);
  useIsolation.setState({ isolated: null });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<Inspector />));
});

afterEach(() => {
  useSnapshotView.setState({ live: null, view: null });
  act(() => mounted.unmount());
  container.remove();
  useDesignSystem.setState({ designSystem: null, saved: null });
});

/** Opens the list of the field showing `value`, as a click does. */
const openField = (value: string) => {
  const field = [
    ...container.querySelectorAll<HTMLInputElement>('input[role="combobox"]'),
  ].find((input) => input.value === value);
  if (!field) {
    throw new Error(`no field shows ${value}`);
  }
  act(() => {
    field.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 })
    );
  });
};

const grid = () => document.querySelector<HTMLElement>('[role="grid"]');
const rows = () => [
  ...document.querySelectorAll<HTMLElement>('[role="grid"] > [role="row"]'),
];
/** Each row as it is read: a palette's by its name, a list row by its text. */
const rowNames = () =>
  rows().map((row) => row.getAttribute("aria-label") ?? row.textContent);
const LIST = [
  "primarySemantic$color-primary",
  "backgroundSemantic$color-background",
];
/** The swatches of a palette's row, by their names. */
const swatchesOf = (name: string) =>
  [
    ...(rows()
      .find((row) => row.getAttribute("aria-label") === name)
      ?.querySelectorAll<HTMLElement>('[role="gridcell"][aria-label]') ?? []),
  ].map((cell) => cell.getAttribute("aria-label"));
const swatch = (name: string) => {
  const found = document.querySelector<HTMLElement>(
    `[role="gridcell"][aria-label="${name}"]`
  );
  if (!found) {
    throw new Error(`no swatch ${name}`);
  }
  return found;
};
const highlighted = () =>
  document
    .querySelector<HTMLElement>("[role=gridcell][data-highlighted]")
    ?.getAttribute("aria-label") ?? null;
/** What the line under the palettes reads. */
const readout = () =>
  document.querySelector('[data-slot="swatch-readout"]')?.textContent;

const press = (key: string) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key })
    );
  });

/** Types a query into the focused field. */
const type = (value: string) => {
  const input = document.activeElement as HTMLInputElement;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const lastCall = (method: string) =>
  fakeApi.calls.findLast((c) => c.method === method)?.input;

describe("a colour field's palettes (UP-136)", () => {
  it("are rows of swatches, each named for its palette, under the semantic colours", () => {
    showing([box("$color-primary")]);
    openField("primary");
    expect(rowNames()).toEqual([...LIST, "Blue", "Red", "Clear"]);
    expect(swatchesOf("Blue")).toEqual(ALL_STEPS.map((s) => `blue-${s}`));
    expect(swatchesOf("Red")).toEqual([
      "red-50",
      "red-200",
      "red-300",
      "red-600",
      "red-700",
      "red-800",
      "red-900",
      "red-950",
    ]);
  });

  /** Opens the box's field and goes down to the first palette's first swatch. */
  const toTheFirstPalette = () => {
    openField("primary");
    for (const _ of [1, 2, 3]) {
      press("ArrowDown");
    }
  };
  const across = (times: number) => {
    for (const _ of Array.from({ length: times })) {
      press("ArrowRight");
    }
  };

  it("are gone along with the arrow keys, from the last list row down into the first palette", () => {
    showing([box("$color-primary")]);
    toTheFirstPalette();
    expect(highlighted()).toBe("blue-50");
    across(6);
    expect(highlighted()).toBe("blue-600");
  });

  it("are gone up and down at the same step", () => {
    showing([box("$color-primary")]);
    toTheFirstPalette();
    across(6);
    press("ArrowDown");
    expect(highlighted()).toBe("red-600");
    press("ArrowUp");
    expect(highlighted()).toBe("blue-600");
  });

  it("read the swatch the keyboard is on under them", () => {
    showing([box("$color-primary")]);
    toTheFirstPalette();
    across(6);
    expect(readout()).toBe("blue-600#666666");
  });

  it.each([
    ["Enter on", () => press("Enter")],
    ["a click on", () => act(() => swatch("blue-600").click())],
  ])("set the field to the swatch %s", async (_, take) => {
    showing([box("$color-primary")]);
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    toTheFirstPalette();
    across(6);
    take();
    await act(() => fakeApi.requested("documents.apply"));
    expect(lastCall("documents.apply")).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [{ id: "box", op: "update", set: { fill: "$color-blue-600" } }],
        },
      ],
      label: "Change the fill",
    });
  });

  it.each([
    ["the nearer one", 5, "red-600"],
    ["the lower of two as near", 1, "red-50"],
  ])(
    "are gone down onto a palette missing the step at its nearest shade, %s",
    (_, steps, landed) => {
      showing([box("$color-primary")]);
      toTheFirstPalette();
      across(steps);
      press("ArrowDown");
      expect(highlighted()).toBe(landed);
    }
  );

  it("are gone down into from the list at a palette's first shade, whatever its step", () => {
    showing([box("$color-primary")], {
      ...ds,
      colors: [
        ds.colors[0] as DesignSystem["colors"][number],
        palette("Green", "green", [100, 200, 300]),
      ],
    });
    toTheFirstPalette();
    expect(highlighted()).toBe("green-100");
  });

  it("mark the swatch of the field's colour", () => {
    showing([box("$color-blue-300")]);
    openField("blue-300");
    const selected = document.querySelector(
      '[role="gridcell"][aria-selected="true"]'
    );
    expect(selected?.getAttribute("aria-label")).toBe("blue-300");
  });

  it("give way to a plain list of every colour a query finds, and come back once it is cleared", () => {
    showing([box("$color-primary")]);
    openField("primary");
    type("blue-6");
    expect(grid()).toBeNull();
    expect(
      [...document.querySelectorAll('[role="option"]')].map(
        (o) => o.textContent
      )
    ).toEqual(["blue-600Blue$color-blue-600", "Use arbitraryblue-6"]);
    type("");
    expect(rowNames()).toEqual([...LIST, "Blue", "Red", "Clear"]);
  });

  it("are left out of a design system with none, its colours the list they were", () => {
    showing([box("$color-primary")], {
      ...ds,
      colors: ds.colors.slice(0, 1),
    });
    openField("primary");
    expect(grid()).toBeNull();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it("stand alone in a design system with nothing else", () => {
    showing([box("$color-blue-50")], {
      ...ds,
      colors: ds.colors.slice(1),
    });
    openField("blue-50");
    expect(rowNames()).toEqual(["Blue", "Red", "Clear"]);
  });

  it("are gone down from a swatch that Use nearest offers too, as from any swatch", () => {
    // Palettes only, so that the two ways are the list above them; `#555556` is nearest
    // blue-500, the sixth swatch of Blue.
    showing([box("#555556")], { ...ds, colors: ds.colors.slice(1) });
    openField("#555556");
    expect(rowNames().slice(0, 2)).toEqual([
      "Use nearestblue-500#555555",
      "New token from this value…",
    ]);
    for (const _ of [1, 2, 3]) {
      press("ArrowDown");
    }
    across(5);
    expect(highlighted()).toBe("blue-500");
    press("ArrowDown");
    expect(highlighted()).toBe("red-600");
  });

  it.each([
    [
      "a text's colour",
      {
        color: "$color-blue-50",
        id: "words",
        role: "paragraph",
        text: "Words",
        type: "text",
      },
    ],
    [
      "a border's colour",
      {
        border: { color: "$color-blue-50", width: 1 },
        children: [],
        id: "edged",
        type: "group",
      },
    ],
    [
      "an image's tint",
      { id: "picture", src: "a.png", tint: "$color-blue-50", type: "image" },
    ],
  ])("are drawn in %s", (_, node) => {
    showing([node as DesignNode]);
    openField("blue-50");
    expect(rowNames()).toContain("Blue");
  });

  it("are drawn in a system component's look", () => {
    const button = defaultLookOf("Button");
    if (!button) {
      throw new Error("no Button");
    }
    useComponents.setState({
      components: [
        {
          ...button,
          base: {
            ...button.base,
            root: { ...button.base.root, fill: "$color-blue-50" },
          },
        },
      ],
    });
    useDesignSystem.setState({ designSystem: ds, saved: ds });
    act(() => mounted.render(<LookInspector meta={undefined} name="Button" />));
    openField("blue-50");
    expect(rowNames()).toContain("Blue");
  });
});
