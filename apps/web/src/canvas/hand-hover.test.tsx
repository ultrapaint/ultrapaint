// @vitest-environment happy-dom
/**
 * The hand (the Pan tool, or Space held) over a page: nothing lights up as if a click would select
 * it, its name in the header or a node of it, and its hover is back at once, the pointer still,
 * when Space is released or another tool is picked.
 */
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { type Mode, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { CanvasGround } from "./canvas-ground.tsx";
import { FrameChrome, SelectLayer } from "./frame.tsx";
import { useFramePointer } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** The page's preview: its heading under every point. */
vi.mock("./editor-frame.ts", async (original) => ({
  ...(await original<typeof import("./editor-frame.ts")>()),
  frameOf: () => ({
    hitTest: () => ["home-root", "heading"],
    listen: () => () => undefined,
    measure: () => ({}),
    pageAt: () => [],
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const heading = {
  id: "heading",
  role: "heading",
  text: "Hi",
  type: "text",
} as DesignNode;
const root = {
  children: [heading],
  id: "home-root",
  type: "page",
} as DesignNode;
const homeDoc: DocumentState = { doc: HOME, hash: `${HOME}@0`, root };
const box = { height: 900, width: 1440, x: 0, y: 0 };

/** The page's frame as `Frame` has it: its header, and its select layer over the preview. */
const Page = () => {
  const pointer = useFramePointer({
    canvas: "main",
    frame: box,
    frameId: HOME,
    root,
  });
  return (
    <div className="group/frame absolute" data-frame={HOME}>
      <FrameChrome
        frame={box}
        frameId={HOME}
        holdsSelection={false}
        isNode={false}
        name="Home"
        onDragStart={() => undefined}
        root={root}
      />
      <SelectLayer
        frameId={HOME}
        name="Home"
        onBack={pointer.onSelectLayerBack}
        onClick={pointer.onSelectClick}
        onContextMenu={pointer.onContextMenu}
        onDoubleClick={pointer.onDoubleClick}
        onGone={pointer.onSelectLayerGone}
        onPointerDown={pointer.onPointerDown}
        onPointerLeave={pointer.onPointerLeave}
        onPointerMove={pointer.onPointerMove}
      />
    </div>
  );
};

const host = document.createElement("div");
let mounted: Root;

const name = () => {
  const found = host.querySelector<HTMLButtonElement>(
    '[data-frame] button[type="button"]:not([aria-label])'
  );
  if (!found) {
    throw new Error("no name over the page");
  }
  return found;
};

const selectLayer = () =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Select in Home"]');

/** Whether the page's name is lit as the pointer over it lights it: in the text's colour, outlined. */
const headerLit = () =>
  !name().className.includes("text-muted-foreground") ||
  [...host.querySelectorAll<HTMLElement>("[data-frame] *")].some(
    (el) => el.style.outline !== ""
  );

/** The node hovered, if any. */
const hovered = () => useEditor.getState().hover?.nodeId ?? null;

/** The pointer moved onto `target` at (x, y), as the browser sends it. */
const moveOnto = (target: Element, x = 40, y = 40) =>
  act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
      })
    );
    target.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: -1,
        clientX: x,
        clientY: y,
        pointerId: 1,
      })
    );
  });

/** Space pressed or released, as the browser sends it. */
const space = (type: "keydown" | "keyup") =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        code: "Space",
        key: " ",
      })
    );
  });

const pick = (mode: Mode) => act(() => useEditor.getState().setMode(mode));

/** The hand taken up: the Pan tool picked, or Space held over the select tool. */
const takeHand = {
  "Space held": () => space("keydown"),
  "the Pan tool": () => pick("pan"),
};
/** The hand put down again, as it was taken up. */
const putDownHand = {
  "Space held": () => space("keyup"),
  "the Pan tool": () => pick("select"),
};
const hands = Object.keys(takeHand) as (keyof typeof takeHand)[];

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
    pages: [
      {
        canvas: "main",
        file: `designs/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
      },
    ],
  });
  useDocuments.setState({ docs: { [HOME]: homeDoc } });
  useEditor.setState({
    also: [],
    canvas: "main",
    frames: { [HOME]: { ...box, preset: "desktop" } },
    hover: null,
    mode: "select",
    selection: null,
    spacePan: false,
    view: { x: 0, y: 0, zoom: 1 },
  });
  document.body.append(host);
  mounted = createRoot(host);
  act(() =>
    mounted.render(
      <CanvasGround background="page" onContextMenu={() => undefined}>
        <Page />
      </CanvasGround>
    )
  );
  // The page's select layer is what the browser finds under the pointer, while it is there.
  vi.spyOn(document, "elementFromPoint").mockImplementation(() =>
    selectLayer()
  );
});

afterEach(() => {
  act(() => mounted.render(null));
  host.remove();
  vi.restoreAllMocks();
});

describe.each(hands)("the hand, by %s, over a page", (hand) => {
  it("leaves its name unlit, and lights it at once when put down", () => {
    takeHand[hand]();
    moveOnto(name());
    expect(headerLit()).toBe(false);
    putDownHand[hand]();
    expect(headerLit()).toBe(true);
  });

  it("hovers no node of it, and hovers the one under the still pointer when put down", () => {
    takeHand[hand]();
    moveOnto(host.querySelector("[data-frame]") as Element);
    expect(hovered()).toBeNull();
    putDownHand[hand]();
    expect(hovered()).toBe("heading");
  });
});

describe("Space released while its pan is dragged over a page", () => {
  it("hovers the node under the still pointer once the pan is let go", () => {
    space("keydown");
    const page = host.querySelector("[data-frame]") as Element;
    moveOnto(page);
    const press = { bubbles: true, button: 0, clientX: 40, clientY: 40 };
    act(() => {
      page.dispatchEvent(
        new PointerEvent("pointerdown", { ...press, buttons: 1, pointerId: 1 })
      );
    });
    space("keyup");
    // The pan goes on until the button is let go: nothing is hovered while it does.
    expect(hovered()).toBeNull();
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { ...press, buttons: 0, pointerId: 1 })
      );
    });
    expect(hovered()).toBe("heading");
  });
});

describe("the hand put down where something covers the page", () => {
  it("hovers no node of it", () => {
    const pin = document.createElement("button");
    vi.mocked(document.elementFromPoint).mockReturnValue(pin);
    space("keydown");
    moveOnto(host.querySelector("[data-frame]") as Element);
    space("keyup");
    expect(hovered()).toBeNull();
  });
});

describe("the hand taken up over a page", () => {
  it("puts out the hover its name and its node had", () => {
    moveOnto(name());
    const layer = selectLayer();
    if (!layer) {
      throw new Error("no select layer");
    }
    moveOnto(layer);
    expect([headerLit(), hovered()]).toEqual([true, "heading"]);
    space("keydown");
    expect([headerLit(), hovered()]).toEqual([false, null]);
  });
});
