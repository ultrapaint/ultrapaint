// @vitest-environment happy-dom
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import type { PointerEvent as ReactPointerEvent } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { viewFrameOf } from "../state/frame-ref.ts";
import { useDrag } from "./drag.ts";
import { useMeasureKey, useWatchMeasureKey } from "./measure-key.ts";
import { MeasureOverlay } from "./measure-overlay.tsx";
import { putBackGesture } from "./pointer-gesture.ts";
import { SelectionChrome } from "./selection-chrome.tsx";
import { useFramePointer } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/**
 * The page as its preview draws it: where each node is, and what is under the pointer wherever
 * it is (the text `t1` in the card unless a test says otherwise).
 */
const page = vi.hoisted(() => ({
  boxes: {
    card: { height: 200, width: 400, x: 40, y: 40 },
    "home-root": { height: 900, width: 1440, x: 0, y: 0 },
    shell: { height: 100, width: 1440, x: 0, y: 400 },
    "shell/nav": { height: 40, width: 200, x: 0, y: 400 },
    "shell/nav/text": { height: 20, width: 60, x: 12, y: 410 },
    t1: { height: 20, width: 100, x: 64, y: 64 },
    t2: { height: 30, width: 400, x: 40, y: 300 },
  } as Record<string, Rect>,
  chain: ["home-root", "card", "t1"],
  /** What listens to the frame's events: told when it draws. */
  listeners: new Set<{ rendered?: (renderId: number) => void }>(),
}));

vi.mock("./editor-frame.ts", async () => {
  const react = await import("react");
  return {
    frameOf: () => ({
      hitTest: () => page.chain,
      measure: (ids: readonly string[]) =>
        Object.fromEntries(
          ids.flatMap((id) => (page.boxes[id] ? [[id, page.boxes[id]]] : []))
        ),
      pageAt: () => [],
    }),
    useFrameEvents: (
      id: string | null,
      listeners: { rendered?: (renderId: number) => void }
    ) =>
      react.useEffect(() => {
        if (id === null) {
          return;
        }
        page.listeners.add(listeners);
        return () => {
          page.listeners.delete(listeners);
        };
      }),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
/** Another view of the home page: another drawing of it (ADR 0036). */
const TABLET = viewFrameOf(HOME, "tablet");
const root: DesignNode = {
  children: [
    {
      children: [{ id: "t1", role: "paragraph", text: "Hi", type: "text" }],
      id: "card",
      type: "column",
    },
    { id: "t2", role: "paragraph", text: "There", type: "text" },
    { component: "Shell", from: "#app", id: "shell", type: "instance" },
  ],
  id: "home-root",
  type: "page",
} as DesignNode;
const homeDoc: DocumentState = { doc: HOME, hash: `${HOME}@0`, root };

type Handlers = ReturnType<typeof useFramePointer>;
let handlers: Handlers | null = null;

/** The canvas: ⌥ heard on the window, the home page's frame and its tablet view. */
const Canvas = () => {
  useWatchMeasureKey();
  const pointer = useFramePointer({
    canvas: "main",
    frame: { x: 0, y: 0 },
    frameId: HOME,
    root,
  });
  useEffect(() => {
    handlers = pointer;
  });
  return (
    <>
      <div data-testid={HOME}>
        <SelectionChrome
          frame={{ height: 900, width: 1440 }}
          frameId={HOME}
          isNode={false}
        />
        <MeasureOverlay frameId={HOME} />
      </div>
      <div data-testid={TABLET}>
        <MeasureOverlay frameId={TABLET} />
      </div>
    </>
  );
};

const pointerAt = (fields: Partial<Record<string, unknown>> = {}) =>
  ({
    altKey: false,
    button: 0,
    clientX: 70,
    clientY: 70,
    ctrlKey: false,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      isConnected: true,
      setPointerCapture: () => undefined,
    },
    detail: 1,
    metaKey: false,
    pointerId: 1,
    shiftKey: false,
    ...fields,
  }) as unknown as ReactPointerEvent;

const pointer = (): Handlers => {
  if (!handlers) {
    throw new Error("the canvas has not rendered");
  }
  return handlers;
};

const key = (type: "keydown" | "keyup", target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, key: "Alt" })
    );
  });
const holdAlt = () => key("keydown");
const letGoOfAlt = () => key("keyup");

const select = (...ids: string[]) => {
  const [lead, ...also] = ids;
  useEditor.setState({
    also: also.map((nodeId) => ({ frame: HOME, nodeId })),
    selection: lead === undefined ? null : { frame: HOME, nodeId: lead },
  });
};
const hover = (nodeId: string, frame = HOME) =>
  act(() => useEditor.getState().setHover({ frame, nodeId }));

let mounted: Root;
let host: HTMLDivElement;

/** The lengths drawn over a frame, in the order they are drawn. */
const lengthsIn = (frame = HOME) =>
  [
    ...host.querySelectorAll(`[data-testid="${frame}"] [data-measure-length]`),
  ].map((pill) => pill.textContent);

beforeEach(() => {
  useDocuments.setState({ docs: { [HOME]: homeDoc } });
  useComponents.setState({
    components: [
      {
        name: "NavItem",
        origin: "app",
        properties: [],
        slots: [],
        tree: {
          children: [
            { id: "text", role: "paragraph", text: "Home", type: "text" },
          ],
          id: "item",
          type: "row",
        },
        version: 1,
      },
      {
        name: "Shell",
        origin: "app",
        properties: [],
        slots: [],
        tree: {
          children: [
            { component: "NavItem", from: "#app", id: "nav", type: "instance" },
          ],
          id: "root",
          type: "row",
        },
        version: 1,
      },
    ],
  });
  useEditor.setState({
    canvas: "main",
    hover: null,
    rects: { [HOME]: { ...page.boxes }, [TABLET]: { ...page.boxes } },
    view: { x: 0, y: 0, zoom: 1 },
  });
  select("t1");
  useDrag.setState({ dragged: null, drop: null });
  host = document.createElement("div");
  document.body.append(host);
  mounted = createRoot(host);
  act(() => mounted.render(<Canvas />));
});

afterEach(() => {
  putBackGesture();
  act(() => mounted.unmount());
  host.remove();
  handlers = null;
  page.chain = ["home-root", "card", "t1"];
  page.boxes.card = { height: 200, width: 400, x: 40, y: 40 };
  useMeasureKey.setState({ held: false });
  useEditor.setState({ also: [], hover: null, rects: {}, selection: null });
  useDrag.setState({ dragged: null, drop: null });
  useComponents.setState({ components: [] });
});

describe("⌥ held over another element in the selection's frame", () => {
  it("draws the space between their facing edges", () => {
    hover("t2");
    expect(lengthsIn()).toEqual([]);
    holdAlt();
    // From the text's bottom (84) to the second text's top (300).
    expect(lengthsIn()).toEqual(["216"]);
  });

  it("takes the selection's size away while it draws, and gives it back", () => {
    hover("t2");
    expect(host.textContent).toContain("×");
    holdAlt();
    expect(host.textContent).not.toContain("×");
    letGoOfAlt();
    expect(host.textContent).toContain("×");
  });

  it("goes as ⌥ is let go", () => {
    hover("t2");
    holdAlt();
    letGoOfAlt();
    expect(lengthsIn()).toEqual([]);
  });

  it("draws its lines and pills in the measuring colour, at their size on screen", () => {
    hover("t2");
    holdAlt();
    const [pill] = host.querySelectorAll<HTMLElement>("[data-measure-length]");
    const [line] = host.querySelectorAll<HTMLElement>("[data-measure-line]");
    expect(pill?.className).toContain("bg-measure");
    expect(pill?.style.transform).toBe("scale(var(--inv))");
    expect(line?.className).toContain("bg-measure");
    // The text under the other: the line runs down, a pixel wide on screen.
    expect(line?.style.width).toBe("calc(1px * var(--inv))");
  });

  it("goes when the pointer leaves the frame", () => {
    act(() => pointer().onPointerMove(pointerAt()));
    holdAlt();
    hover("t2");
    expect(lengthsIn()).toEqual(["216"]);
    act(() => pointer().onPointerLeave());
    expect(lengthsIn()).toEqual([]);
  });

  it("goes when the window loses focus", () => {
    hover("t2");
    holdAlt();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(useMeasureKey.getState().held).toBe(false);
    expect(lengthsIn()).toEqual([]);
  });

  it("starts from the box around several selected", () => {
    select("t1", "t2");
    hover("shell/nav");
    holdAlt();
    // From the second text's bottom (330) to the nav's top (400).
    expect(lengthsIn()).toEqual(["70"]);
  });

  it("draws nothing with nothing selected", () => {
    select();
    hover("t2");
    holdAlt();
    expect(lengthsIn()).toEqual([]);
  });

  it("draws nothing while a drag copies", () => {
    hover("t2");
    holdAlt();
    act(() =>
      useDrag.setState({
        dragged: {
          frame: HOME,
          kind: "node",
          node: { id: "t1", role: "paragraph", text: "Hi", type: "text" },
          rect: page.boxes.t1 as Rect,
        },
      })
    );
    expect(lengthsIn()).toEqual([]);
  });

  it("draws nothing while a marquee is drawn", () => {
    hover("t2");
    holdAlt();
    expect(lengthsIn()).toEqual(["216"]);
    // A press on the page itself, where nothing is hit, travels: a marquee.
    page.chain = ["home-root"];
    act(() => pointer().onPointerDown(pointerAt()));
    // The press is followed on the window (ADR 0133).
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          buttons: 1,
          clientX: 200,
          clientY: 70,
          pointerId: 1,
        })
      );
    });
    expect(lengthsIn()).toEqual([]);
  });

  it("draws nothing in another view of the page", () => {
    hover("t2", TABLET);
    holdAlt();
    expect(lengthsIn(TABLET)).toEqual([]);
    expect(lengthsIn()).toEqual([]);
  });

  it("is not held by ⌥ typed in a field", () => {
    const field = document.createElement("input");
    host.append(field);
    hover("t2");
    key("keydown", field);
    expect(useMeasureKey.getState().held).toBe(false);
    expect(lengthsIn()).toEqual([]);
  });
});

describe("⌥ held over the selection's parent, or the selection itself", () => {
  it("draws the four insets in the parent pointed at", () => {
    hover("card");
    holdAlt();
    // The text at 64,64 (100 × 20) in the card at 40,40 (400 × 200).
    expect(lengthsIn()).toEqual(["24", "276", "24", "156"]);
  });

  it("draws the same insets over the selection itself, its parent measured", () => {
    hover("t1");
    holdAlt();
    expect(lengthsIn()).toEqual(["24", "276", "24", "156"]);
  });

  it("reads the parent again each time the frame draws", () => {
    hover("t1");
    holdAlt();
    page.boxes.card = { height: 300, width: 400, x: 40, y: 40 };
    act(() => {
      for (const listener of page.listeners) {
        listener.rendered?.(2);
      }
    });
    expect(lengthsIn()).toEqual(["24", "276", "24", "256"]);
  });

  it("draws the insets of several selected in the parent they share", () => {
    select("t2", "shell");
    hover("t2");
    holdAlt();
    // The box around them, 300 to 500 down the page, as wide as it.
    expect(lengthsIn()).toEqual(["300", "400"]);
  });

  it("draws nothing over several selected in different parents", () => {
    select("t1", "t2");
    hover("t1");
    holdAlt();
    expect(lengthsIn()).toEqual([]);
  });

  it("measures a layer of an instance in the layer around it", () => {
    select("shell/nav/text");
    hover("shell/nav/text");
    holdAlt();
    expect(lengthsIn()).toEqual(["12", "128", "10", "10"]);
  });

  it("draws nothing for a page's root, which has no parent", () => {
    select("home-root");
    hover("home-root");
    holdAlt();
    expect(lengthsIn()).toEqual([]);
  });
});

describe("an element inside the selection, with ⌥ held", () => {
  it("is measured to the selection's edges", () => {
    select("card");
    hover("t1");
    holdAlt();
    expect(lengthsIn()).toEqual(["24", "276", "24", "156"]);
  });
});
