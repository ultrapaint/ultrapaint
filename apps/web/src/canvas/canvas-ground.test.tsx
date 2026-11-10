// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { CanvasGround } from "./canvas-ground.tsx";
import { canvasPoint } from "./drag.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

/** A field outside the canvas, as the chat's composer is, and the canvas beside it. */
const field = document.createElement("textarea");

/** A press on the ground that, as the marquee's does, keeps the browser from moving the focus. */
const pressGround = () => {
  const ground = host.querySelector("[data-canvas]");
  ground?.addEventListener("pointerdown", (e) => e.preventDefault(), {
    once: true,
  });
  act(() => {
    ground?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 })
    );
  });
};

beforeEach(() => {
  useEditor.setState({
    mode: "select",
    spacePan: false,
    view: { x: 0, y: 0, zoom: 1 },
  });
  document.body.append(field);
  act(() =>
    root.render(
      <CanvasGround background="page" onContextMenu={() => undefined}>
        <input aria-label="On the canvas" />
      </CanvasGround>
    )
  );
});

afterEach(() => {
  act(() => root.render(null));
  field.remove();
  vi.restoreAllMocks();
});

describe("a press on the canvas", () => {
  it("takes the focus from a field outside it, so the keys are the canvas's", () => {
    field.focus();
    pressGround();
    expect(document.activeElement).not.toBe(field);
  });

  it("leaves a field on the canvas focused", () => {
    const inside = host.querySelector("input");
    inside?.focus();
    pressGround();
    expect(document.activeElement).toBe(inside);
  });
});

describe("a pointer on the canvas", () => {
  it("is placed by where the ground was laid out, read once and not at every move", () => {
    const ground = host.querySelector("[data-canvas]") as HTMLElement;
    const read = vi
      .spyOn(ground, "getBoundingClientRect")
      .mockReturnValue({ left: 40, top: 30 } as DOMRect);
    // The window resized: the ground is laid out, and measured, again.
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    useEditor.setState({ view: { x: 10, y: 20, zoom: 2 } });
    const reads = read.mock.calls.length;
    expect(canvasPoint(150, 150)).toEqual({ x: 50, y: 50 });
    expect(canvasPoint(250, 150)).toEqual({ x: 100, y: 50 });
    expect(read).toHaveBeenCalledTimes(reads);
  });

  it("is placed from the window's corner once the ground is gone", () => {
    const ground = host.querySelector("[data-canvas]") as HTMLElement;
    vi.spyOn(ground, "getBoundingClientRect").mockReturnValue({
      left: 40,
      top: 30,
    } as DOMRect);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    act(() => root.render(null));
    expect(canvasPoint(150, 150)).toEqual({ x: 150, y: 150 });
  });
});
