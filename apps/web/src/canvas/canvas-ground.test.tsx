// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { CanvasGround } from "./canvas-ground.tsx";

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
  useEditor.setState({ mode: "select", spacePan: false });
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
