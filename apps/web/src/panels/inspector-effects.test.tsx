// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** A page of boxes, each with the shadow given. */
const pageOf = (boxes: Record<string, string | undefined>): DocumentState => ({
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: Object.entries(boxes).map(([id, shadow]) => ({
      children: [],
      id,
      type: "column",
      ...(shadow !== undefined && { shadow }),
    })),
    id: "home",
    type: "page",
  } as DesignNode,
});

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
    press("Add shadow");
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
});
