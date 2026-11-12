// @vitest-environment happy-dom
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { PointerEvent as ReactPointerEvent } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComments } from "../state/comments.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { viewFrameOf } from "../state/frame-ref.ts";
import { useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useDrag } from "./drag.ts";
import { cancelGesture } from "./frame-gesture.ts";
import { useFramePointer } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** What the page's preview has under every point: the text `t1` unless a test says otherwise. */
const under = vi.hoisted(() => ({ chain: ["home-root", "t1"] }));

/** The page's preview: `under` at every point, the text `t1` where it is drawn. */
vi.mock("./editor-frame.ts", () => ({
  frameOf: () => ({
    hitTest: () => under.chain,
    measure: () => ({ t1: { height: 20, width: 50, x: 10, y: 10 } }),
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
  under.chain = ["home-root", "t1"];
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
        component: "Promo",
        entered: "t1",
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

describe("the comment tool", () => {
  it("on a view of a page, starts the page's comment on what was clicked", () => {
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
      nodeId: "t1",
      pageId: HOME,
      x: 30,
      y: 41,
    });
  });
});
