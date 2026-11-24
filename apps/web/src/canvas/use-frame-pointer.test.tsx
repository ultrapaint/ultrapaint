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
import { paletteCommands } from "../lib/commands.ts";
import { type MenuEntry, menuFor, runMenuAction } from "../lib/menu-actions.ts";
import { openSelectionMenuByKey } from "../lib/shortcuts.ts";
import { useComments } from "../state/comments.ts";
import { useComponents } from "../state/components.ts";
import { useContextMenu } from "../state/context-menu.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { nodeFrameOf, viewFrameOf } from "../state/frame-ref.ts";
import { isolate, leaveTo, useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { select, selectMany } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useDrag } from "./drag.ts";
import { useWatchMeasureKey } from "./measure-key.ts";
import { putBackGesture } from "./pointer-gesture.ts";
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
      isConnected: true,
      setPointerCapture: () => undefined,
    },
    metaKey: false,
    pointerId: 1,
    shiftKey: false,
  }) as unknown as ReactPointerEvent;

/** The pointer pressed in the frame, as the window hears it until it is let go. */
const windowHears = (type: string, clientX = 0, clientY = 0) =>
  act(() => {
    window.dispatchEvent(
      new PointerEvent(type, {
        buttons: type === "pointerup" ? 0 : 1,
        clientX,
        clientY,
        pointerId: 1,
      })
    );
  });

const current = (): Handlers => {
  if (!handlers) {
    throw new Error("the probe has not rendered");
  }
  return handlers;
};

/** A right-click in the frame, which opens the menu of what it is on. */
const rightClick = () =>
  act(() =>
    current().onContextMenu({
      ...pointerAt(20, 20),
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    } as unknown as Parameters<Handlers["onContextMenu"]>[0])
  );

/** The rows of Select layer in the menu open now, or in the menu of a target. */
const layerRows = (
  target = useContextMenu.getState().request?.target
): MenuEntry[] => {
  const found = (target ? menuFor(target) : null)?.find(
    (e) => e.kind === "submenu" && e.id === "layers"
  );
  return found?.kind === "submenu" ? [...found.entries] : [];
};

const rowLabels = () =>
  layerRows().map((e) => (e.kind === "item" ? e.label : e.kind));

/** Picks a row of Select layer, by its label, as a click on it does. */
const pickRow = (label: string) => {
  const row = layerRows().find((e) => e.kind === "item" && e.label === label);
  if (row?.kind !== "item") {
    throw new Error(`no row ${label}`);
  }
  act(() => {
    runMenuAction(row.action);
  });
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
  putBackGesture();
  act(() => mounted.unmount());
  handlers = null;
  under.at = null;
  under.chain = ["home-root", "t1"];
  under.held = [];
  useIsolation.setState({ isolated: null });
});

describe("a node dragged inside a page", () => {
  it("is put back when the browser takes the pointer away", async () => {
    act(() => current().onPointerDown(pointerAt(20, 20)));
    // Off the page, over the empty canvas: let go there, it would land on the canvas.
    windowHears("pointermove", 2000, 2000);
    expect(useDrag.getState()).toMatchObject({
      dragged: { kind: "node" },
      drop: { kind: "canvas" },
    });
    windowHears("pointercancel");
    expect(useDrag.getState().dragged).toBeNull();
    // The pointerup that may still come lands nothing.
    windowHears("pointerup");
    await Promise.resolve();
    expect(fakeApi.calls.filter((c) => c.method === "documents.apply")).toEqual(
      []
    );
  });

  it("lands where it is let go", async () => {
    act(() => current().onPointerDown(pointerAt(20, 20)));
    windowHears("pointermove", 2000, 2000);
    windowHears("pointerup", 2000, 2000);
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
    windowHears("pointermove", 40, 30);
    expect(useEditor.getState().hover).toBeNull();
    windowHears("pointerup", 40, 30);
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

  it("are listed by a right-click by their names, nested instances' too, down to the instance (ADR 0143)", () => {
    rightClick();
    expect(rowLabels()).toEqual(["Home", "NavItem", "Column", "Shell", "home"]);
  });

  it("are selected by their row in a right-click's Select layer (ADR 0143)", () => {
    rightClick();
    pickRow("NavItem");
    expect(selected()).toBe("shell/nav");
  });

  it("are never moved on the page, and a double-click opens no main component", () => {
    useEditor.setState({ selection: { frame: HOME, nodeId: "shell/side" } });
    under.chain = ["home-root", "shell", "shell/side"];
    act(() => current().onPointerDown(pointerAt(20, 20)));
    windowHears("pointermove", 400, 400);
    expect(useDrag.getState().dragged).toBeNull();
    windowHears("pointerup", 400, 400);
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
    windowHears("pointerup", 20, 20);
    expect(hovered()).toBe("t1");
  });

  it("hovers what is under the pointer where a press let it go", () => {
    inACard();
    // The page is empty left of 100, the text in its card from there on.
    under.at = (x) => (x < 100 ? ["home-root"] : under.chain);
    act(() => current().onPointerDown(pointerAt(20, 20)));
    // The press travels, the layer holding the pointer hearing it as the window does.
    windowHears("pointermove", 300, 300);
    act(() => current().onPointerMove(pointerAt(300, 300)));
    windowHears("pointerup", 300, 300);
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

describe("Select layer, the layers under a right-click (ADR 0143)", () => {
  const title = {
    id: "title",
    level: 3,
    role: "heading",
    text: "Plans",
    type: "text",
  } as DesignNode;
  const card = {
    children: [title],
    id: "card",
    name: "Card",
    type: "column",
  } as DesignNode;
  const other = { children: [], id: "other", type: "column" } as DesignNode;
  /** Drawn over the list, beside it in the page: not one of the layers the list is in. */
  const overlay = { children: [], id: "overlay", type: "group" } as DesignNode;
  const list = {
    children: [card, other],
    id: "list",
    type: "row",
  } as DesignNode;

  /** The page, its card or its title changed. */
  const withPage = (changes: Partial<Record<string, Partial<DesignNode>>>) => {
    const at = (node: DesignNode): DesignNode =>
      ({
        ...node,
        ...changes[node.id],
        ...("children" in node && {
          children: node.children.map(at),
        }),
      }) as DesignNode;
    useDocuments.setState({
      docs: {
        [HOME]: {
          ...homeDoc,
          root: at({
            children: [list, overlay],
            id: "home-root",
            type: "page",
          } as DesignNode),
        },
      },
    });
  };

  /** Every node selected now, the one the inspector shows first. */
  const allSelected = () => {
    const { also, selection } = useEditor.getState();
    return selection ? [selection, ...also] : [];
  };
  const ticked = () =>
    layerRows().flatMap((e) =>
      e.kind === "item" && e.checked ? [e.label] : []
    );

  /** The probe drawn in another frame: a view of the page, or a node beside the pages. */
  const renderIn = (frameId: string) =>
    act(() =>
      mounted.render(
        <Probe
          frameId={frameId}
          report={(h) => {
            handlers = h;
          }}
        />
      )
    );

  /** The card placed beside the pages, and the probe in its frame. */
  const besideThePages = () => {
    useDocuments.setState({
      docs: {
        [HOME]: homeDoc,
        [canvasDocOf("main")]: {
          doc: canvasDocOf("main"),
          hash: "canvas@0",
          root: {
            children: [card],
            id: "canvas-root",
            type: "page",
          } as DesignNode,
        },
      },
    });
    renderIn(nodeFrameOf("card"));
  };

  beforeEach(() => {
    withPage({});
    useEditor.setState({ also: [], selection: null });
    under.chain = ["home-root", "list", "card", "title"];
  });

  it("lists every layer the element under the pointer is in, the deepest first and the page last, and no sibling drawn over them", () => {
    rightClick();
    expect(rowLabels()).toEqual(["Plans", "Card", "Row", "home"]);
  });

  it("names each layer as Layers does: its name, else what it is and what it says", () => {
    withPage({ card: { name: undefined }, title: { text: "" } });
    rightClick();
    expect(rowLabels()).toEqual(["Heading 3", "Column", "Row", "home"]);
  });

  it("ticks the layers selected", () => {
    select({ frame: HOME, nodeId: "list" });
    rightClick();
    expect(ticked()).toEqual(["Row"]);
  });

  it("selects the layer picked alone, as a click on it would", () => {
    rightClick();
    pickRow("Plans");
    expect(allSelected()).toEqual([{ frame: HOME, nodeId: "title" }]);
  });

  it("selects the page by its row", () => {
    rightClick();
    pickRow("home");
    expect(allSelected()).toEqual([{ frame: HOME, nodeId: "home-root" }]);
  });

  it("lists the layers of a node beside the pages down to that node", () => {
    besideThePages();
    under.chain = ["card", "title"];
    rightClick();
    expect(rowLabels()).toEqual(["Plans", "Card"]);
  });

  it("selects a node beside the pages by its row, in its frame", () => {
    besideThePages();
    under.chain = ["card", "title"];
    rightClick();
    pickRow("Card");
    expect(allSelected()).toEqual([
      { frame: nodeFrameOf("card"), nodeId: "card" },
    ]);
  });

  it("leaves out a locked layer and what it holds, as a click passes them by", () => {
    withPage({ card: { locked: true } });
    rightClick();
    expect(rowLabels()).toEqual(["Row", "home"]);
  });

  it("leaves out a hidden layer", () => {
    withPage({ title: { hidden: true } });
    rightClick();
    expect(rowLabels()).toEqual(["Card", "Row", "home"]);
  });

  it("lists a layer hidden at the base and shown at the breakpoint of the view right-clicked in (ADR 0036)", () => {
    withPage({ title: { at: { md: { hidden: false } }, hidden: true } });
    // A view at 800 px: `md`, of the default breakpoints.
    useEditor.setState((s) => ({
      frames: {
        ...s.frames,
        [TABLET]: { height: 900, preset: "custom", width: 800, x: 0, y: 0 },
      },
    }));
    renderIn(TABLET);
    rightClick();
    expect(rowLabels()).toEqual(["Plans", "Card", "Row", "home"]);
  });

  /** The card and its neighbour selected, the card first. */
  const cardAndOther = () =>
    selectMany([
      { frame: HOME, nodeId: "card" },
      { frame: HOME, nodeId: "other" },
    ]);

  it("keeps a selection of several right-clicked in", () => {
    cardAndOther();
    rightClick();
    expect(allSelected()).toHaveLength(2);
  });

  it("ticks the layers of a selection of several that are under the pointer", () => {
    cardAndOther();
    rightClick();
    expect(ticked()).toEqual(["Card"]);
  });

  it("narrows a selection of several to the layer picked", () => {
    cardAndOther();
    rightClick();
    pickRow("Plans");
    expect(allSelected()).toEqual([{ frame: HOME, nodeId: "title" }]);
  });

  it("in a view of the page, lists the layers as it draws them and selects in that view (ADR 0036)", () => {
    renderIn(TABLET);
    rightClick();
    expect(rowLabels()).toEqual(["Plans", "Card", "Row", "home"]);
    pickRow("Card");
    expect(allSelected()).toEqual([{ frame: TABLET, nodeId: "card" }]);
  });

  it("is not offered for a single layer", () => {
    besideThePages();
    // The node's own ground, nothing inside it under the pointer.
    under.chain = ["card"];
    rightClick();
    expect(useContextMenu.getState().request?.target).toMatchObject({
      nodeId: "card",
    });
    expect(layerRows()).toEqual([]);
  });

  it("is not in the menu the menu key or ⇧F10 opens", () => {
    select({ frame: HOME, nodeId: "card" });
    useContextMenu.setState({ open: false, request: null });
    act(() => {
      openSelectionMenuByKey();
    });
    expect(useContextMenu.getState().request?.target).toMatchObject({
      nodeId: "card",
    });
    expect(layerRows()).toEqual([]);
  });

  it("is not in a node's menu opened without a point, as a Layers row's and a frame header's are", () => {
    expect(layerRows({ frame: HOME, kind: "node", nodeId: "card" })).toEqual(
      []
    );
  });

  it("is not in the command palette", () => {
    useEditor.setState({ workspace: "design" });
    select({ frame: HOME, nodeId: "card" });
    expect(
      paletteCommands().filter((c) => c.title.startsWith("Select layer"))
    ).toEqual([]);
  });
});
