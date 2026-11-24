// @vitest-environment happy-dom
/**
 * A marquee drawn inside a page, driven by pointer events as the browser sends them: to the page's
 * select layer while it holds the pointer, to whatever is under the pointer once it does not
 * (the ground), and to nowhere at all when the release happens outside the window.
 */
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepBack } from "../lib/shortcuts.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Marquee, SelectLayer } from "./frame.tsx";
import { followPointer, putBackGesture } from "./pointer-gesture.ts";
import { useFramePointer } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** What the page's preview has under every point: the page itself unless a test says otherwise. */
const under = vi.hoisted(() => ({ chain: ["home-root"] }));

/** The page's preview: `under` at every point, its two texts where they are drawn. */
vi.mock("./editor-frame.ts", async (original) => ({
  ...(await original<typeof import("./editor-frame.ts")>()),
  frameOf: () => ({
    hitTest: () => under.chain,
    listen: () => () => undefined,
    measure: () => ({
      t1: { height: 20, width: 50, x: 10, y: 10 },
      t2: { height: 20, width: 50, x: 10, y: 200 },
    }),
    pageAt: () => [],
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const root = {
  children: [
    { id: "t1", role: "paragraph", text: "Hi", type: "text" },
    { id: "t2", role: "paragraph", text: "There", type: "text" },
  ],
  id: "home-root",
  type: "page",
} as DesignNode;
const homeDoc: DocumentState = { doc: HOME, hash: `${HOME}@0`, root };

/** The page's frame on the ground, its select layer and the marquee it draws, as `Frame` has them. */
const Page = () => {
  const pointer = useFramePointer({
    canvas: "main",
    frame: { x: 0, y: 0 },
    frameId: HOME,
    root,
  });
  return (
    <div data-frame={HOME}>
      <SelectLayer
        frameId={HOME}
        name="home"
        onClick={pointer.onSelectClick}
        onContextMenu={pointer.onContextMenu}
        onDoubleClick={pointer.onDoubleClick}
        onGone={pointer.onSelectLayerGone}
        onPointerDown={pointer.onPointerDown}
        onPointerLeave={pointer.onPointerLeave}
        onPointerMove={pointer.onPointerMove}
      />
      {pointer.marquee ? <Marquee box={pointer.marquee} /> : null}
    </div>
  );
};

let ground: HTMLDivElement;
let mounted: Root;

/** The page's select layer, while it is there. */
const layer = () =>
  ground.querySelector<HTMLButtonElement>(
    'button[aria-label="Select in home"]'
  );

/** The marquee drawn in the page, where the camera's layer would have it; null when none is. */
const drawn = () => {
  const el = ground.querySelector<HTMLElement>(".border-selection");
  return el
    ? {
        height: Number.parseFloat(el.style.height),
        width: Number.parseFloat(el.style.width),
        x: Number.parseFloat(el.style.left),
        y: Number.parseFloat(el.style.top),
      }
    : null;
};

/** A pointer event at a point, the left button held unless `buttons` says otherwise. */
const pointer = (
  type: string,
  x: number,
  y: number,
  buttons = type === "pointerup" ? 0 : 1
) =>
  new PointerEvent(type, {
    bubbles: true,
    button: type === "pointermove" ? -1 : 0,
    buttons,
    cancelable: true,
    clientX: x,
    clientY: y,
    composed: true,
    pointerId: 1,
  });

/** Sends an event to `target` and lets what it draws on the next frame be drawn. */
const send = async (target: EventTarget, event: Event) => {
  act(() => {
    target.dispatchEvent(event);
  });
  await act(() => new Promise((next) => requestAnimationFrame(next)));
};

/** A press in the page at (x, y), dragged to each point in turn over the page's select layer. */
const pressAndDrag = async (
  from: { x: number; y: number },
  ...to: { x: number; y: number }[]
) => {
  const target = layer();
  if (!target) {
    throw new Error("the select layer is not there");
  }
  await send(target, pointer("pointerdown", from.x, from.y));
  for (const p of to) {
    // biome-ignore lint/performance/noAwaitInLoops: each move is drawn before the next is sent, as the browser does.
    await send(target, pointer("pointermove", p.x, p.y));
  }
};

/** What is selected, as node ids. */
const selected = () => {
  const { also, selection } = useEditor.getState();
  return [selection, ...also].flatMap((s) => (s ? [s.nodeId] : []));
};

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
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
    also: [],
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    hover: null,
    mode: "select",
    selection: null,
    spacePan: false,
    view: { x: 0, y: 0, zoom: 1 },
  });
  ground = document.createElement("div");
  ground.dataset.canvas = "";
  document.body.append(ground);
  mounted = createRoot(ground);
  act(() => mounted.render(<Page />));
});

afterEach(() => {
  under.chain = ["home-root"];
  putBackGesture();
  act(() => mounted.unmount());
  ground.remove();
});

describe("a marquee drawn in a page", () => {
  it("ends where it is let go, though Space took the page's select layer away under it", async () => {
    await pressAndDrag({ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 60 });
    expect(drawn()).toEqual({ height: 60, width: 80, x: 0, y: 0 });
    // Space held: the select layer goes, and the pointer it held with it; the release lands on
    // the ground under the pointer.
    act(() => useEditor.setState({ spacePan: true }));
    expect(layer()).toBeNull();
    await send(ground, pointer("pointermove", 90, 70));
    act(() => useEditor.setState({ spacePan: false }));
    await send(ground, pointer("pointerup", 90, 70));
    expect(drawn()).toBeNull();
    expect(selected()).toEqual(["t1"]);
    // The next press in the page begins a marquee of its own, where it is pressed.
    await pressAndDrag(
      { x: 300, y: 300 },
      { x: 310, y: 310 },
      { x: 320, y: 330 }
    );
    expect(drawn()).toEqual({ height: 30, width: 20, x: 300, y: 300 });
  });

  it("let go after the view moved under a still pointer, selects what it covers where the pointer is then", async () => {
    await pressAndDrag({ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 60 });
    act(() => useEditor.setState({ spacePan: true }));
    // The page panned right under the pointer: it now reaches 5 pixels into the page, short of t1.
    act(() => useEditor.setState({ view: { x: 75, y: 0, zoom: 1 } }));
    await send(ground, pointer("pointerup", 80, 60));
    expect(drawn()).toBeNull();
    expect(selected()).toEqual([]);
  });

  it("follows the pointer out of the page and back in, and selects what it covers where it is let go", async () => {
    await pressAndDrag({ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 60 });
    // Out of the page, over the ground and past the frame's edge.
    await send(ground, pointer("pointermove", 2000, 1500));
    expect(drawn()).toEqual({ height: 1500, width: 2000, x: 0, y: 0 });
    // Back in, and let go there.
    await send(ground, pointer("pointermove", 70, 50));
    await send(ground, pointer("pointerup", 70, 50));
    expect(drawn()).toBeNull();
    expect(selected()).toEqual(["t1"]);
  });

  it("let go outside the window, whose release never came, ends at the pointer's next move", async () => {
    await pressAndDrag({ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 250 });
    // The pointer comes back with no button held.
    await send(ground, pointer("pointermove", 200, 300, 0));
    expect(drawn()).toBeNull();
    expect(selected()).toEqual(["t1", "t2"]);
  });

  it("is put away by Escape, the selection as it was and its release selecting nothing", async () => {
    useEditor.setState({ selection: { frame: HOME, nodeId: "t2" } });
    await pressAndDrag({ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 60 });
    let stepped = false;
    act(() => {
      stepped = stepBack();
    });
    expect(stepped).toBe(true);
    expect(drawn()).toBeNull();
    await send(ground, pointer("pointermove", 100, 80));
    await send(ground, pointer("pointerup", 100, 80));
    expect(drawn()).toBeNull();
    expect(selected()).toEqual(["t2"]);
  });

  it("is put away when the window loses the focus, and its release selects nothing", async () => {
    useEditor.setState({ selection: { frame: HOME, nodeId: "t2" } });
    await pressAndDrag({ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 60 });
    await send(window, new Event("blur"));
    expect(drawn()).toBeNull();
    await send(ground, pointer("pointerup", 100, 80));
    expect(drawn()).toBeNull();
    expect(selected()).toEqual(["t2"]);
  });

  it("hovers nothing while another frame's gesture follows the pointer over it", async () => {
    const elsewhere = {
      cancel: () => undefined,
      move: () => undefined,
      up: () => undefined,
    };
    under.chain = ["home-root", "t1"];
    followPointer({ pointerId: 1 }, elsewhere);
    const target = layer();
    if (!target) {
      throw new Error("the select layer is not there");
    }
    await send(target, pointer("pointermove", 20, 20));
    expect(useEditor.getState().hover).toBeNull();
  });
});
