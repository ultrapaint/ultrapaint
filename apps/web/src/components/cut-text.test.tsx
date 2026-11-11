// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CutText } from "./cut-text.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

/**
 * What the tooltip says once the mouse rests on a name laid out `width` wide in a box `room`
 * wide; null when none opens. happy-dom lays nothing out, so the sizes are given.
 */
const tooltipAt = (width: number, room: number) => {
  act(() => mounted.render(<CutText>Checkout summary</CutText>));
  const text = container.querySelector("span") as HTMLElement;
  Object.defineProperty(text, "scrollWidth", { value: width });
  Object.defineProperty(text, "clientWidth", { value: room });
  act(() => {
    text.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  return (
    document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? null
  );
};

/**
 * What the tooltip says once the row around a name laid out `width` wide in `room` takes the
 * keyboard's focus (`reveal`), the pointer nowhere near it; null when none opens.
 */
const tooltipOnFocus = (width: number, room: number) => {
  act(() => mounted.render(<CutText>Checkout summary</CutText>));
  const text = container.querySelector("span") as HTMLElement;
  Object.defineProperty(text, "scrollWidth", { value: width });
  Object.defineProperty(text, "clientWidth", { value: room });
  act(() => mounted.render(<CutText reveal>Checkout summary</CutText>));
  return (
    document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? null
  );
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
});

describe("a name cut short", () => {
  it("shows its whole self in the tooltip", () => {
    expect(tooltipAt(180, 120)).toBe("Checkout summary");
  });

  it("shows no tooltip when it fits", () => {
    expect(tooltipAt(120, 120)).toBeNull();
  });

  it("shows its whole self while its row has the keyboard's focus", () => {
    expect(tooltipOnFocus(180, 120)).toBe("Checkout summary");
  });

  it("shows no tooltip on the row's focus when it fits", () => {
    expect(tooltipOnFocus(120, 120)).toBeNull();
  });
});
