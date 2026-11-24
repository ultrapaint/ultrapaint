// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
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
import { fakeApi } from "../testing/fake-api.ts";
import { Inspector } from "./inspector.tsx";
import { LookInspector } from "./look-inspector.tsx";
import { TextStyleInspector } from "./token-inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#2563eb" },
        { name: "color-taken", value: "#ff0000" },
      ],
    },
  ],
  shadows: [{ name: "shadow-sm", value: "0 1px 2px black" }],
};

/** A box, a text, an image and a column, each with what a test gives it. */
const homeWith = (fields: {
  readonly box?: Record<string, unknown>;
  readonly column?: Record<string, unknown>;
  readonly image?: Record<string, unknown>;
  readonly text?: Record<string, unknown>;
}): DocumentState => ({
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [
      { children: [], id: "box", type: "group", ...fields.box },
      {
        id: "picture",
        src: "a.png",
        type: "image",
        ...fields.image,
      },
      { children: [], id: "stack", type: "column", ...fields.column },
      {
        id: "words",
        role: "paragraph",
        text: "Words",
        type: "text",
        ...fields.text,
      },
    ],
    id: "home",
    type: "page",
  } as DesignNode,
});

const initialEditor = useEditor.getState();
const initialBoard = useBoard.getState();
let mounted: Root;
let container: HTMLElement;

const showing = (home: DocumentState, designSystem: DesignSystem = ds) => {
  useDesignSystem.setState({ designSystem, saved: designSystem });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
};

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
  act(() => mounted.unmount());
  container.remove();
  useDesignSystem.setState({ designSystem: null, saved: null });
});

/** The field showing `value`, closed. */
const fieldShowing = (value: string) => {
  const field = [
    ...container.querySelectorAll<HTMLInputElement>('input[role="combobox"]'),
  ].find((input) => input.value === value);
  if (!field) {
    throw new Error(`no field shows ${value}`);
  }
  return field;
};

/** Opens the list of the field showing `value`, as a click does. */
const openField = (value: string) => {
  const field = fieldShowing(value);
  act(() => {
    field.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 })
    );
  });
};

const options = () => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
];
const option = (label: string) =>
  options().find((o) => o.textContent?.startsWith(label));

const pick = (label: string) => {
  const found = option(label);
  if (!found) {
    throw new Error(`no option ${label}`);
  }
  act(() => found.click());
};

const lastCall = (method: string) =>
  fakeApi.calls.findLast((c) => c.method === method)?.input;

describe("a field whose value is outside the design system", () => {
  it("offers the nearest token first, with its name and value", () => {
    showing(homeWith({ box: { fill: "#2563ea" } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    openField("#2563ea");
    expect(options()[0]?.textContent).toBe("Use nearestprimary#2563eb");
  });

  it("offers a new token from the value under the nearest", () => {
    showing(homeWith({ box: { fill: "#2563ea" } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    openField("#2563ea");
    expect(options()[1]?.textContent).toBe("New token from this value…");
  });

  it("is put on the nearest token by picking it, as any pick is", async () => {
    showing(homeWith({ box: { fill: "#2563ea" } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    openField("#2563ea");
    pick("Use nearest");
    await act(() => fakeApi.requested("documents.apply"));
    expect(lastCall("documents.apply")).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [{ id: "box", op: "update", set: { fill: "$color-primary" } }],
        },
      ],
      label: "Change the fill",
    });
  });

  it("offers a spacing the nearest step of the scale, written in pixels", async () => {
    showing(homeWith({ column: { gap: 17.5 } }));
    act(() => select({ frame: HOME, nodeId: "stack" }));
    fakeApi.respond("documents.apply", () => ({ changes: [], created: [] }));
    openField("17.5");
    expect(option("Use nearest")?.textContent).toBe(
      "Use nearestspacing-4.518px"
    );
    pick("Use nearest");
    await act(() => fakeApi.requested("documents.apply"));
    expect(lastCall("documents.apply")).toMatchObject({
      edits: [{ ops: [{ id: "stack", set: { gap: 18 } }] }],
    });
  });

  it("offers a shadow only a new token, there being no nearest shadow", () => {
    showing(homeWith({ box: { shadow: "0 4px 9px black" } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    openField("0 4px 9px black");
    expect(option("Use nearest")).toBeUndefined();
    expect(options()[0]?.textContent).toBe("New token from this value…");
  });

  it("offers neither on the design system", () => {
    showing(homeWith({ box: { fill: "$color-primary" } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    openField("primary");
    expect(options().length).toBeGreaterThan(0);
    expect(option("Use nearest")).toBeUndefined();
    expect(option("New token from this value…")).toBeUndefined();
  });

  it("carries the dot on a spacing off every whole and half step, and not on a half step", () => {
    showing(homeWith({ box: { padding: 17.5 }, column: { gap: 18 } }));
    act(() => select({ frame: HOME, nodeId: "stack" }));
    const dotOn = (value: string) =>
      fieldShowing(value)
        .closest('[data-slot="input-group"]')
        ?.querySelector('[aria-label="Outside the design system"]') ?? null;
    expect(dotOn("18")).toBeNull();
    act(() => select({ frame: HOME, nodeId: "box" }));
    expect(dotOn("17.5")).not.toBeNull();
  });
});

describe("a new token from a field's value", () => {
  const naming = () =>
    document.querySelector<HTMLInputElement>(
      'input[aria-label="The new token\'s name"]'
    );
  const type = (value: string) => {
    const input = naming() as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const press = (key: string) =>
    act(() => {
      naming()?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key })
      );
    });
  const addButton = () =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Add token"
    );

  /** Opens New token on the box's fill of `#2563ea`. */
  const namingTheFill = () => {
    showing(homeWith({ box: { fill: "#2563ea" } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    openField("#2563ea");
    pick("New token from this value…");
  };

  it("is named first with its kind's prefix", () => {
    namingTheFill();
    expect(document.body.textContent).toContain("New token");
    expect(naming()?.value).toBe("color-");
  });

  it("refuses a name a token has, in the Design system place's words", () => {
    namingTheFill();
    type("color-taken");
    expect(document.body.textContent).toContain(
      "color-taken exists already. Give the new token another name."
    );
    expect(addButton()?.disabled).toBe(true);
    press("Enter");
    expect(lastCall("designSystem.edit")).toBeUndefined();
  });

  it("makes the token and sets the field to it in one edit on Enter", async () => {
    namingTheFill();
    fakeApi.respond("designSystem.edit", () => ({ changes: [], files: [] }));
    type("color-brand");
    press("Enter");
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(lastCall("designSystem.edit")).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [{ id: "box", op: "update", set: { fill: "$color-brand" } }],
        },
      ],
      label: "Change the fill",
      ops: [{ name: "color-brand", op: "addToken", value: "#2563ea" }],
    });
    expect(lastCall("documents.apply")).toBeUndefined();
    expect(naming()).toBeNull();
  });

  it("makes nothing when Escape lets it go", () => {
    showing(homeWith({ box: { radius: 7 } }));
    act(() => select({ frame: HOME, nodeId: "box" }));
    openField("7");
    pick("New token from this value…");
    expect(naming()?.value).toBe("radius-");
    press("Escape");
    expect(naming()).toBeNull();
    expect(fakeApi.calls.map((c) => c.method)).not.toContain(
      "designSystem.edit"
    );
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("documents.apply");
  });

  it("is named in the namespace of what an image's tint colours, in a detailed system", () => {
    showing(homeWith({ image: { tint: "#2563ea" } }), {
      ...ds,
      tokenPreset: "detailed",
    });
    act(() => select({ frame: HOME, nodeId: "picture" }));
    openField("#2563ea");
    pick("New token from this value…");
    expect(naming()?.value).toBe("background-color-");
  });
  it("is named in the namespace of a text's colour, in a detailed system", () => {
    showing(homeWith({ text: { color: "#2563ea" } }), {
      ...ds,
      tokenPreset: "detailed",
    });
    act(() => select({ frame: HOME, nodeId: "words" }));
    openField("#2563ea");
    pick("New token from this value…");
    expect(naming()?.value).toBe("text-color-");
  });

  it("sets a layer of an instance as the instance's override, the main component left alone", async () => {
    useComponents.setState({
      components: [
        {
          name: "Promo",
          origin: "app",
          properties: [],
          slots: [],
          tree: {
            children: [
              { id: "sale", role: "paragraph", text: "Sale", type: "text" },
            ],
            id: "p-root",
            type: "column",
          },
          version: 1,
        } as never,
      ],
    });
    showing({
      doc: HOME,
      hash: `${HOME}@0`,
      root: {
        children: [
          {
            component: "Promo",
            from: "#app",
            id: "promo",
            overrides: { sale: { color: "#2563ea" } },
            type: "instance",
          },
        ],
        id: "home",
        type: "page",
      } as DesignNode,
    });
    act(() => select({ frame: HOME, nodeId: "promo/sale" }));
    fakeApi.respond("designSystem.edit", () => ({ changes: [], files: [] }));
    openField("#2563ea");
    pick("New token from this value…");
    type("color-brand");
    press("Enter");
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(lastCall("designSystem.edit")).toMatchObject({
      edits: [
        {
          doc: HOME,
          ops: [
            {
              id: "promo/sale",
              op: "update",
              set: { color: "$color-brand" },
            },
          ],
        },
      ],
      ops: [{ name: "color-brand", op: "addToken", value: "#2563ea" }],
    });
    expect(fakeApi.calls.map((c) => c.method)).not.toContain(
      "components.change"
    );
  });

  it("from a system component's look, is named as what it colours and changes the look in the token's edit", async () => {
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
            root: {
              ...button.base.root,
              border: { color: "#2563ea", width: 1 },
            },
          },
        },
      ],
    });
    useDesignSystem.setState({
      designSystem: { ...ds, tokenPreset: "detailed" },
    });
    act(() => mounted.render(<LookInspector meta={undefined} name="Button" />));
    fakeApi.respond("designSystem.edit", () => ({ files: [] }));
    openField("#2563ea");
    pick("New token from this value…");
    expect(naming()?.value).toBe("border-color-");
    type("border-color-brand");
    press("Enter");
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(lastCall("designSystem.edit")).toMatchObject({
      component: {
        change: {
          op: "setStyle",
          place: { state: null, variant: null },
          slot: "root",
          style: { border: { color: "$border-color-brand", width: 1 } },
        },
        name: "Button",
      },
      ops: [{ name: "border-color-brand", op: "addToken", value: "#2563ea" }],
    });
    expect(fakeApi.calls.map((c) => c.method)).not.toContain(
      "components.change"
    );
  });
});

describe("the nearest colour on a board", () => {
  it("is measured in the theme the boards are drawn in", () => {
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
            root: { ...button.base.root, fill: "#60a5fb" },
          },
        },
      ],
    });
    useDesignSystem.setState({
      designSystem: {
        ...ds,
        colors: [
          {
            name: "Semantic",
            tokens: [
              {
                name: "color-primary",
                value: "#2563eb",
                values: { dark: "#60a5fa" },
              },
            ],
          },
        ],
        themes: ["light", "dark"],
      },
    });
    useBoard.setState({
      open: { item: "Button", view: "library" },
      theme: "dark",
    });
    act(() => mounted.render(<LookInspector meta={undefined} name="Button" />));
    openField("#60a5fb");
    expect(options()[0]?.textContent).toBe("Use nearestprimary#60a5fa");
  });
});

describe("a new token from a text style's setting", () => {
  it("is made with the style set to it, in one edit of the design system", async () => {
    const styled: DesignSystem = {
      ...ds,
      typography: {
        ...ds.typography,
        sizes: [{ name: "text-base", value: "1rem" }],
        styles: [{ name: "Lead", role: "paragraph", size: 19 }],
      },
    };
    useDesignSystem.setState({ designSystem: styled, saved: styled });
    act(() => mounted.render(<TextStyleInspector ds={styled} name="Lead" />));
    fakeApi.respond("designSystem.edit", () => ({ files: [] }));
    openField("19");
    pick("New token from this value…");
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="The new token\'s name"]'
    ) as HTMLInputElement;
    expect(name.value).toBe("text-");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(name, "text-lead");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      name.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
    });
    await act(() => fakeApi.requested("designSystem.edit"));
    expect(
      fakeApi.calls.filter((c) => c.method === "designSystem.edit")
    ).toEqual([
      {
        input: {
          ops: [
            { name: "text-lead", op: "addToken", value: "19px" },
            {
              op: "setTextStyle",
              style: { name: "Lead", role: "paragraph", size: "$text-lead" },
            },
          ],
        },
        method: "designSystem.edit",
      },
    ]);
  });
});
