// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useComments } from "../state/comments.ts";
import { type Mode, useEditor } from "../state/editor.ts";
import { CanvasGround } from "./canvas-ground.tsx";
import { Toolbar } from "./toolbar.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

/** A field outside the canvas, as the chat's composer is. */
const field = document.createElement("textarea");

const ground = () => host.querySelector("[data-canvas]") as HTMLElement;

const tool = (label: string) => {
  const found = host.querySelector<HTMLButtonElement>(
    `[role="toolbar"] [aria-label="${label}"]`
  );
  if (!found) {
    throw new Error(`no ${label} tool`);
  }
  return found;
};

/** Space pressed or released on what has the focus, as the browser sends it. */
const space = (
  type: "keydown" | "keyup",
  { repeat = false }: { repeat?: boolean } = {}
) => {
  const target = (document.activeElement ?? document.body) as HTMLElement;
  const e = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code: "Space",
    key: " ",
    repeat,
  });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};

/** Space held, the key repeating as a held key does, then released. */
const holdSpace = () => {
  space("keydown");
  space("keydown", { repeat: true });
  space("keydown", { repeat: true });
  const held = useEditor.getState().spacePan;
  space("keyup");
  return held;
};

const pointer = (type: string) => {
  act(() => {
    ground().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
      })
    );
  });
};

beforeEach(() => {
  useEditor.setState({
    mode: "select",
    spacePan: false,
    view: { x: 0, y: 0, zoom: 1 },
  });
  // The comments' visibility starts from storage; each test starts with them hidden.
  useComments.setState({ visible: false });
  document.body.append(field);
  act(() =>
    root.render(
      <CanvasGround
        background="page"
        onContextMenu={() => undefined}
        overlay={<Toolbar />}
      >
        {null}
      </CanvasGround>
    )
  );
});

afterEach(() => {
  act(() => root.render(null));
  field.remove();
  (document.activeElement as HTMLElement | null)?.blur();
  useComments.setState({ visible: false });
});

describe("Space held over the canvas", () => {
  it("shows the open hand while held, and the tool's cursor again once released", () => {
    space("keydown");
    expect(ground().className).toContain("cursor-grab");
    space("keyup");
    expect(ground().className).not.toContain("cursor-grab");
    expect(useEditor.getState().mode).toBe("select");
  });

  it("drags with the closed hand, and gives the tool back once released mid-drag", () => {
    space("keydown");
    pointer("pointerdown");
    expect(ground().className).toContain("cursor-grabbing");
    space("keyup");
    // The drag that began as a pan stays one until the button is let go.
    expect(useEditor.getState()).toMatchObject({
      mode: "select",
      spacePan: false,
    });
    expect(ground().className).toContain("cursor-grabbing");
    pointer("pointerup");
    expect(ground().className).not.toContain("cursor-grab");
  });

  it.each<[string, Mode]>([
    ["Pan", "select"],
    ["Select", "text"],
    ["Comment", "select"],
    ["Text", "select"],
  ])(
    "pans, and does not press the %s tool that has the focus",
    (label, mode) => {
      useEditor.setState({ mode });
      tool(label).focus();
      expect(holdSpace()).toBe(true);
      expect(useEditor.getState()).toMatchObject({ mode, spacePan: false });
      expect(useComments.getState().visible).toBe(false);
    }
  );

  it("is typed into a field, and never pans", () => {
    field.focus();
    const typed = space("keydown");
    expect(typed.defaultPrevented).toBe(false);
    expect(useEditor.getState().spacePan).toBe(false);
  });

  it("is left to a menu that is open, and does not pan", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    const pressed = space("keydown");
    menu.remove();
    expect(pressed.defaultPrevented).toBe(false);
    expect(useEditor.getState().spacePan).toBe(false);
  });
});

describe("Space held, then the focus moved into a field", () => {
  it("keeps its repeats the pan's, and types once pressed again", () => {
    space("keydown");
    field.focus();
    const repeat = space("keydown", { repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(useEditor.getState().spacePan).toBe(true);
    space("keyup");
    expect(space("keydown").defaultPrevented).toBe(false);
    expect(useEditor.getState().spacePan).toBe(false);
  });
});

describe("a pan by Space ends", () => {
  it("when Space is released on a field the focus went to", () => {
    space("keydown");
    field.focus();
    space("keyup");
    expect(useEditor.getState().spacePan).toBe(false);
  });

  it("when the window loses the focus", () => {
    space("keydown");
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(useEditor.getState().spacePan).toBe(false);
  });

  it("when the page is hidden", () => {
    space("keydown");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // biome-ignore lint/performance/noDelete: the document's own `hidden` goes, the prototype's is read again.
    delete (document as { hidden?: boolean }).hidden;
    expect(useEditor.getState().spacePan).toBe(false);
  });
});
