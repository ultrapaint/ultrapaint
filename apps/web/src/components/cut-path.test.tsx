// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CutPath } from "./cut-path.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

const PATH = "/home/you/code/shop/src/pages/checkout.tsx";

/** The box the path is cut in: the one element that holds the path's own text. */
const cutBox = () =>
  container.querySelector("bdi")?.parentElement as HTMLElement;

/** What the tooltip says once the mouse rests on the path, laid out wider than its box. */
const tooltip = () => {
  const box = cutBox();
  Object.defineProperty(box, "scrollWidth", { value: 400 });
  Object.defineProperty(box, "clientWidth", { value: 120 });
  act(() => {
    box.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
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

describe("a path cut short (ADR 0108)", () => {
  // happy-dom lays nothing out, so which end is cut is seen in a browser; this holds the
  // structure that puts it at the start: a right-to-left box around a left-to-right path.
  it("is laid out to be cut at its start, its own text kept left to right", () => {
    act(() => mounted.render(<CutPath path={PATH} />));
    expect(cutBox().dir).toBe("rtl");
    expect(cutBox().querySelector("bdi")?.dir).toBe("ltr");
    expect(container.textContent).toBe(PATH);
  });

  it("shows its whole self in the tooltip", () => {
    act(() => mounted.render(<CutPath path={PATH} />));
    expect(tooltip()).toBe(PATH);
  });

  it("keeps a remote project's host whole, cutting only its folder", () => {
    const remote = "build-box:2222:/srv/checkouts/shop";
    act(() => mounted.render(<CutPath path={remote} />));
    expect(container.textContent).toBe(remote);
    expect(cutBox().textContent).toBe("/srv/checkouts/shop");
    expect(tooltip()).toBe(remote);
  });

  it("opens no tooltip of its own inside a row whose tooltip says more", () => {
    act(() => mounted.render(<CutPath path={PATH} tooltip={false} />));
    expect(tooltip()).toBeNull();
    expect(container.textContent).toBe(PATH);
  });
});
