// @vitest-environment happy-dom
import type {
  DesignNode,
  DocumentState,
  InstanceNode,
} from "@ultrapaint/contracts/document";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import type { PointerEvent as ReactPointerEvent } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComments } from "../state/comments.ts";
import { useComponents } from "../state/components.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { nodeFrameOf, viewFrameOf } from "../state/frame-ref.ts";
import { isolate, leaveTo, useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useDrag } from "./drag.ts";
import { cancelGesture } from "./frame-gesture.ts";
import { useWatchMeasureKey } from "./measure-key.ts";
import { useFramePointer } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/**
 * What the page's preview has under every point: the text `t1` unless a test says otherwise, and
 * what a slot of a component edited in place holds there (nothing unless a test says so).
 */
const under = vi.hoisted(() => ({
  /** What is under a point, where a test draws the page; `chain` everywhere else. */
  at: null as ((x: number) => string[]) | null,
  chain: ["home-root", "t1"],
  held: [] as string[],
}));

/** The page's preview: `under` at every point, the text `t1` where it is drawn. */
vi.mock("./editor-frame.ts", () => ({
  frameOf: () => ({
    hitTest: (x: number) => under.at?.(x) ?? under.chain,
    measure: () => ({ t1: { height: 20, width: 50, x: 10, y: 10 } }),
    pageAt: () => under.held,
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
/** A view of the home page: the page drawn again at another width (ADR 0036). */
const TABLET = viewFrameOf(HOME, "tablet");
const root: DesignNode = {
  children: [
    { id: "t1", role: "paragraph", text: "Hi", type: "text" },
    { id: "t2", role: "paragraph", text: "There", type: "text" },
  ],
  id: "home-root",
  type: "page",
} as DesignNode;
const homeDoc: DocumentState = { doc: HOME, hash: `${HOME}@0`, root };

type Handlers = ReturnType<typeof useFramePointer>;
let handlers: Handlers | null = null;

/** Hands on the handlers of each render, as the frame would use them. */
const Probe = ({
  frameId = HOME,
  report,
}: {
  frameId?: string;
  report: (h: Handlers) => void;
}) => {
  // ⌥ is heard on the window, as the canvas hears it.
  useWatchMeasureKey();
  const latest = useFramePointer({
    canvas: "main",
    frame: { x: 0, y: 0 },
    frameId,
    root,
  });
  useEffect(() => report(latest));
  return null;
};

const pointerAt = (clientX: number, clientY: number) =>
  ({
    altKey: false,
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: () => undefined,
    },
    metaKey: false,
    pointerId: 1,
    shiftKey: false,
  }) as unknown as ReactPointerEvent;

const current = (): Handlers => {
  if (!handlers) {
    throw new Error("the probe has not rendered");
  }
  return handlers;
};

let mounted: Root;

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("documents.apply", () => ({ created: [], documents: [] }));
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
    info: {
      configured: true,
      host: { state: "stopped" },
      storage: { mode: "managed" },
    },
    pages: [
      {
        canvas: "main",
        file: `designs/${HOME}`,
        id: HOME,
        name: "home",
        path: HOME,
      },
    ],
  });
  useDocuments.setState({ docs: { [HOME]: homeDoc } });
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    selection: { frame: HOME, nodeId: "t1" },
    view: { x: 0, y: 0, zoom: 1 },
  });
  useDrag.setState({ dragged: null, drop: null });
  mounted = createRoot(document.createElement("div"));
  act(() =>
    mounted.render(
      <Probe
        report={(h) => {
          handlers = h;
        }}
      />
    )
  );
});

afterEach(() => {
  act(() => mounted.unmount());
  handlers = null;
  under.at = null;
  under.chain = ["home-root", "t1"];
  under.held = [];
  useIsolation.setState({ isolated: null });
});

describe("a node dragged inside a page", () => {
  it("is put back when the browser takes the pointer away", async () => {
    current().onPointerDown(pointerAt(20, 20));
    // Off the page, over the empty canvas: let go there, it would land on the canvas.
    current().onPointerMove(pointerAt(2000, 2000));
    expect(useDrag.getState()).toMatchObject({
      dragged: { kind: "node" },
      drop: { kind: "canvas" },
    });
    current().onPointerCancel();
    expect(useDrag.getState().dragged).toBeNull();
    // The pointerup that may still come lands nothing.
    current().onPointerUp();
    await Promise.resolve();
    expect(fakeApi.calls.filter((c) => c.method === "documents.apply")).toEqual(
      []
    );
  });

  it("lands where it is let go", async () => {
    current().onPointerDown(pointerAt(20, 20));
    current().onPointerMove(pointerAt(2000, 2000));
    current().onPointerUp();
    await fakeApi.requested("documents.apply");
    expect(
      fakeApi.calls.filter((c) => c.method === "documents.apply")
    ).toHaveLength(1);
  });
});

describe("a marquee", () => {
  it("hovers nothing while it is drawn", () => {
    useEditor.setState({ hover: { frame: HOME, nodeId: "t2" } });
    under.chain = ["home-root"];
    act(() => current().onPointerDown(pointerAt(0, 0)));
    act(() => current().onPointerMove(pointerAt(40, 30)));
    expect(useEditor.getState().hover).toBeNull();
  });

  it("is put away by Escape: nothing drawn, the selection as it was", async () => {
    under.chain = ["home-root"];
    useEditor.setState({ selection: { frame: HOME, nodeId: "t2" } });
    act(() => current().onPointerDown(pointerAt(0, 0)));
    act(() => current().onPointerMove(pointerAt(40, 30)));
    act(() => current().onPointerMove(pointerAt(80, 60)));
    await act(() => new Promise((drawn) => requestAnimationFrame(drawn)));
    expect(current().marquee).toEqual({ height: 60, width: 80, x: 0, y: 0 });
    let stopped = false;
    act(() => {
      stopped = cancelGesture();
    });
    expect(stopped).toBe(true);
    expect(current().marquee).toBeNull();
    // Nothing is left to put away, and its release selects nothing.
    expect(cancelGesture()).toBe(false);
    act(() => current().onPointerUp());
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "t2",
    });
  });
});

describe("a component edited in place", () => {
  /** A click at a point, as the frame's select layer is clicked. */
  const clickAt = (x: number, y: number) =>
    ({ ...pointerAt(x, y), detail: 1 }) as unknown as Parameters<
      Handlers["onSelectClick"]
    >[0];
  const editing = (frame: string) =>
    useIsolation.setState({
      isolated: {
        around: null,
        component: "Promo",
        drawn: "t1",
        frame,
        instance: "t1",
        variant: null,
      },
    });

  it("is kept by a click on it, and left by a click on the page dimmed around it", () => {
    editing(HOME);
    act(() => current().onSelectClick(clickAt(20, 20)));
    expect(useIsolation.getState().isolated).not.toBeNull();
    // The page around it is not hit: nothing is under the pointer there.
    under.chain = [];
    act(() => current().onSelectClick(clickAt(600, 600)));
    expect(useIsolation.getState().isolated).toBeNull();
    // The instance it was entered from is selected again.
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "t1",
    });
  });

  it("is left by a click in another frame, which selects there", () => {
    editing(TABLET);
    act(() => current().onSelectClick(clickAt(20, 20)));
    expect(useIsolation.getState().isolated).toBeNull();
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "t1",
    });
  });
});

describe("what a slot of a component edited in place holds (ADR 0123)", () => {
  const click = (fields: Partial<Record<string, unknown>> = {}) =>
    ({ ...pointerAt(20, 20), detail: 1, ...fields }) as unknown as Parameters<
      Handlers["onSelectClick"]
    >[0];
  const instanceIn = (tree: DesignNode, id: string) =>
    (tree.type !== "text" && "children" in tree
      ? (tree.children ?? []).find((n) => n.id === id)
      : undefined) as InstanceNode;
  const promo: DesignNode = {
    children: [{ children: [], id: "d-extra", type: "column" }],
    id: "d-root",
    type: "column",
  } as DesignNode;
  const shell: DesignNode = {
    children: [
      { component: "Switcher", from: "#app", id: "switch", type: "instance" },
      { id: "label", role: "paragraph", text: "Menu", type: "text" },
    ],
    id: "root",
    type: "row",
  } as DesignNode;
  const page: DesignNode = {
    children: [
      {
        children: [
          {
            children: [
              { id: "t2-inner", role: "paragraph", text: "Hi", type: "text" },
            ],
            id: "t2",
            type: "column",
          },
        ],
        component: "Promo",
        from: "#app",
        id: "promo",
        type: "instance",
      },
      { component: "Shell", from: "#app", id: "shell", type: "instance" },
    ],
    id: "home-root",
    type: "page",
  } as DesignNode;
  const app = (name: string, tree: DesignNode) => ({
    name,
    origin: "app" as const,
    properties: [],
    slots: [],
    tree,
    version: 1,
  });

  beforeEach(() => {
    useComponents.setState({
      components: [
        app("Promo", promo),
        app("Shell", shell),
        app("Switcher", {
          children: [{ children: [], id: "s-slot", type: "column" }],
          id: "s-root",
          type: "column",
        } as DesignNode),
      ],
    });
    useDocuments.setState({ docs: { [HOME]: { ...homeDoc, root: page } } });
  });

  afterEach(() => {
    leaveTo(0);
  });

  it("is reached past the slot's node, the component left and the page's node selected", () => {
    isolate(HOME, instanceIn(page, "promo"));
    under.chain = ["d-root", "d-extra"];
    under.held = ["t2", "t2-inner"];
    // The slot's node first: the click stays in the component.
    act(() => current().onSelectClick(click()));
    expect(useIsolation.getState().isolated).not.toBeNull();
    expect(useEditor.getState().selection?.nodeId).toBe("d-extra");
    // Past it, the page's node the slot holds.
    act(() => current().onSelectClick(click()));
    expect(useIsolation.getState().isolated).toBeNull();
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "t2",
    });
  });

  it("is reached at once, its innermost node, with Ctrl or ⌘", () => {
    isolate(HOME, instanceIn(page, "promo"));
    under.chain = ["d-root", "d-extra"];
    under.held = ["t2", "t2-inner"];
    act(() => current().onSelectClick(click({ metaKey: true })));
    expect(useIsolation.getState().isolated).toBeNull();
    expect(useEditor.getState().selection?.nodeId).toBe("t2-inner");
  });

  it("is selected at the level around that holds it, by its own id there", () => {
    isolate(HOME, instanceIn(page, "shell"));
    const outer = useIsolation.getState().isolated;
    isolate(HOME, instanceIn(shell, "switch"));
    expect(useIsolation.getState().isolated?.drawn).toBe("shell/switch");
    useEditor.setState({ selection: { frame: HOME, nodeId: "s-slot" } });
    under.chain = ["s-root", "s-slot"];
    under.held = ["shell/label"];
    act(() => current().onSelectClick(click()));
    expect(useIsolation.getState().isolated).toBe(outer);
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "label",
    });
  });
});

describe("an instance's layers on a page (ADR 0114)", () => {
  const click = (x: number, fields: Partial<Record<string, unknown>> = {}) =>
    ({ ...pointerAt(x, 20), detail: 1, ...fields }) as unknown as Parameters<
      Handlers["onSelectClick"]
    >[0];
  const selected = () => useEditor.getState().selection?.nodeId;

  beforeEach(() => {
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
              {
                children: [
                  {
                    component: "NavItem",
                    from: "#app",
                    id: "nav",
                    type: "instance",
                  },
                ],
                id: "side",
                type: "column",
              },
            ],
            id: "root",
            type: "row",
          },
          version: 1,
        },
      ],
    });
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...homeDoc,
          root: {
            children: [
              {
                component: "Shell",
                from: "#app",
                id: "shell",
                type: "instance",
              },
            ],
            id: "home-root",
            type: "page",
          },
        },
      },
    });
    useEditor.setState({ selection: null });
    under.chain = [
      "home-root",
      "shell",
      "shell/side",
      "shell/nav",
      "shell/nav/text",
    ];
  });

  it("are stepped into a click at a time, nested instances' too", () => {
    const steps: (string | undefined)[] = [];
    for (let i = 0; i < 4; i += 1) {
      act(() => current().onSelectClick(click(20)));
      steps.push(selected());
    }
    expect(steps).toEqual([
      "shell",
      "shell/side",
      "shell/nav",
      "shell/nav/text",
    ]);
  });

  it("are reached at once with Ctrl or ⌘, as with Alt", () => {
    act(() => current().onSelectClick(click(20, { metaKey: true })));
    expect(selected()).toBe("shell/nav/text");
    useEditor.setState({ selection: null });
    act(() => current().onSelectClick(click(20, { ctrlKey: true })));
    expect(selected()).toBe("shell/nav/text");
  });

  it("are never moved on the page, and a double-click opens no main component", () => {
    useEditor.setState({ selection: { frame: HOME, nodeId: "shell/side" } });
    under.chain = ["home-root", "shell", "shell/side"];
    current().onPointerDown(pointerAt(20, 20));
    current().onPointerMove(pointerAt(400, 400));
    expect(useDrag.getState().dragged).toBeNull();
    current().onPointerUp();
    under.chain = ["home-root", "shell"];
    act(() => current().onDoubleClick(click(20)));
    expect(useIsolation.getState().isolated).toBeNull();
  });
});

describe("the comment tool", () => {
  it("on a view of a page, starts the page's comment on what was clicked, in that view", () => {
    useComments.setState({ comments: [], draft: null, visible: true });
    act(() =>
      mounted.render(
        <Probe
          frameId={TABLET}
          report={(h) => {
            handlers = h;
          }}
        />
      )
    );
    current().onPlaceComment(pointerAt(30.4, 40.6));
    expect(useComments.getState().draft).toEqual({
      element: "Hi",
      frame: TABLET,
      nodeId: "t1",
      pageId: HOME,
      x: 30,
      y: 41,
    });
  });

  it("on a node beside the pages, starts the canvas's comment on that node, which it moves with", () => {
    const card = {
      children: [{ id: "c1", role: "paragraph", text: "Card", type: "text" }],
      id: "card",
      type: "column",
    } as DesignNode;
    const canvasRoot = { children: [card], id: "canvas-root", type: "page" };
    useDocuments.setState({
      docs: {
        [HOME]: homeDoc,
        [canvasDocOf("main")]: {
          doc: canvasDocOf("main"),
          hash: "canvas@0",
          root: canvasRoot as DesignNode,
        },
      },
    });
    useComments.setState({ comments: [], draft: null, visible: true });
    act(() =>
      mounted.render(
        <Probe
          frameId={nodeFrameOf("card")}
          report={(h) => {
            handlers = h;
          }}
        />
      )
    );
    // On an element inside it, still the node's: one of its children may go, the node stays.
    under.chain = ["card", "c1"];
    current().onPlaceComment(pointerAt(12, 8));
    expect(useComments.getState().draft).toEqual({
      element: "Column",
      frame: nodeFrameOf("card"),
      nodeId: "card",
      pageId: null,
      x: 12,
      y: 8,
    });
  });
});

describe("⌥ held over a page (ADR 0131)", () => {
  /** The text `t1` drawn inside a card, which a plain hover stops at. */
  const inACard = () => {
    under.chain = ["home-root", "card", "t1"];
    useEditor.setState({ selection: { frame: HOME, nodeId: "t2" } });
  };
  const hovered = () => useEditor.getState().hover?.nodeId;
  /** ⌥ pressed or let go on the window, with Ctrl or ⌘ held or not. */
  const alt = (type: "keydown" | "keyup", others: { metaKey?: boolean } = {}) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { key: "Alt", ...others }));
    });

  it("hovers the innermost node under a pointer at rest the moment it is pressed", () => {
    inACard();
    act(() => current().onPointerMove(pointerAt(20, 20)));
    expect(hovered()).toBe("card");
    alt("keydown");
    expect(hovered()).toBe("t1");
  });

  it("hovers again what a click would select once it is let go", () => {
    inACard();
    act(() => current().onPointerMove(pointerAt(20, 20)));
    alt("keydown");
    alt("keyup");
    expect(hovered()).toBe("card");
  });

  it("keeps hovering the innermost node when it is let go with ⌘ still held", () => {
    inACard();
    act(() => current().onPointerMove(pointerAt(20, 20)));
    alt("keydown");
    alt("keyup", { metaKey: true });
    // A click with ⌘ held still goes to the innermost node.
    expect(hovered()).toBe("t1");
  });

  it("hovers the innermost node once a press it was pressed during ends", () => {
    inACard();
    act(() => current().onPointerMove(pointerAt(20, 20)));
    act(() => current().onPointerDown(pointerAt(20, 20)));
    alt("keydown");
    // The press keeps what it is about while it lasts.
    expect(hovered()).toBe("card");
    act(() => current().onPointerUp());
    expect(hovered()).toBe("t1");
  });

  it("hovers what is under the pointer where a press let it go", () => {
    inACard();
    // The page is empty left of 100, the text in its card from there on.
    under.at = (x) => (x < 100 ? ["home-root"] : under.chain);
    act(() => current().onPointerDown(pointerAt(20, 20)));
    act(() => current().onPointerMove(pointerAt(300, 300)));
    act(() => current().onPointerUp());
    alt("keydown");
    expect(hovered()).toBe("t1");
  });

  it("still selects the innermost node with a click", () => {
    inACard();
    act(() =>
      current().onSelectClick({
        ...pointerAt(20, 20),
        altKey: true,
        detail: 1,
      } as unknown as Parameters<Handlers["onSelectClick"]>[0])
    );
    expect(useEditor.getState().selection?.nodeId).toBe("t1");
  });
});
