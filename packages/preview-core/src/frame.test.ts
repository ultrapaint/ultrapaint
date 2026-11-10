// @vitest-environment happy-dom

import { themeSelector } from "@ultrapaint/contracts/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameRuntime, FrameShown } from "./preview.ts";
import { BODY_ATTRIBUTE } from "./styles.ts";
import { scriptedPreview } from "./testing.ts";

const { page, preview } = scriptedPreview();

const opened: FrameRuntime[] = [];
afterEach(() => {
  for (const runtime of opened.splice(0)) {
    runtime.unmount();
  }
  document.body.replaceChildren();
});

/** A frame of the canvas, mounted and shown as `shown` (taking input), drawn in `theme`. */
const open = (
  name: string,
  theme: string,
  shown: Partial<FrameShown> = { interactive: true }
) => {
  const host = document.createElement("div");
  document.body.append(host);
  const navigateTo = vi.fn();
  const runtime = preview.mountFrame(host, {
    canvas: "canvas",
    events: { navigateTo },
    frame: name,
    shown,
  });
  opened.push(runtime);
  const body = host.shadowRoot?.querySelector(
    `[${BODY_ATTRIBUTE}]`
  ) as HTMLElement;
  /** The editor draws the frame; `code` is what its renderer does meanwhile. */
  const draw = (code: Parameters<typeof page>[0]) => {
    page(code);
    runtime.render({
      defaults: { theme },
      designSystem: null,
      mode: "page",
      renderId: 1,
      root: null,
    });
  };
  return { body, draw, host, navigateTo, runtime };
};

const key = (target: EventTarget) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, composed: true, key: "/" })
  );

describe("a frame's host", () => {
  it("is marked drawn once its page has drawn", () => {
    const { draw, host } = open("a", "light");
    expect(host.hasAttribute("data-ed-drawn")).toBe(false);
    draw(() => undefined);
    expect(host.getAttribute("data-ed-drawn")).toBe("");
  });

  it("is shown as the editor asks: marked, its class, style and title, away", () => {
    const { host, runtime } = open("a", "light", {
      className: "block h-full",
      style: "position: absolute; left: 4px",
      title: "Home",
    });
    expect(host.getAttribute("data-ed-frame-host")).toBe("a");
    expect([...host.classList]).toEqual(["block", "h-full"]);
    expect(host.style.left).toBe("4px");
    expect(host.title).toBe("Home");
    runtime.show({ away: true, className: "block", style: "left: 8px" });
    expect([...host.classList]).toEqual(["block"]);
    expect(host.style.left).toBe("8px");
    expect(host.style.position).toBe("");
    expect(host.style.contentVisibility).toBe("hidden");
    runtime.show({ away: false });
    expect(host.style.contentVisibility).toBe("");
    expect(host.title).toBe("Home");
  });

  it("takes input only while asked: the pointer and focus go past a picture", () => {
    const { body, host, runtime } = open("a", "light", {});
    expect(host.style.pointerEvents).toBe("none");
    expect(body.hasAttribute("inert")).toBe(true);
    runtime.show({ interactive: true });
    expect(host.style.pointerEvents).toBe("auto");
    expect(body.hasAttribute("inert")).toBe(false);
    runtime.show({ interactive: false });
    expect(host.style.pointerEvents).toBe("none");
    expect(body.hasAttribute("inert")).toBe(true);
  });

  it("is where an event from the frame comes from, and nothing else is", () => {
    const { body } = open("a", "light");
    const outside = document.createElement("button");
    document.body.append(outside);
    const fromFrame: boolean[] = [];
    const hear = (e: Event) => fromFrame.push(preview.fromFrame(e));
    document.addEventListener("keydown", hear);
    try {
      key(body);
      key(outside);
      // A host the core does not draw, marked as one, is not a frame.
      const stray = document.createElement("div");
      stray.setAttribute("data-ed-frame-host", "stray");
      document.body.append(stray);
      key(stray);
    } finally {
      document.removeEventListener("keydown", hear);
    }
    expect(fromFrame).toEqual([true, false, false]);
  });
});

describe("a frame's theme", () => {
  it("is on its body as the theme's selector reads it: one word, as a class and as data-theme", () => {
    const { body, draw } = open("a", "dark");
    draw(() => undefined);
    expect(body.getAttribute("data-theme")).toBe("dark");
    expect([...body.classList]).toEqual(["dark"]);
    expect(body.matches(themeSelector("dark"))).toBe(true);
  });

  it("is its own when its name is two words, and not the theme one of them names", () => {
    const { body, draw } = open("a", "dark mode");
    draw(() => undefined);
    expect(body.matches(themeSelector("dark mode"))).toBe(true);
    expect(body.matches(themeSelector("dark"))).toBe(false);
    expect(body.matches(themeSelector("mode"))).toBe(false);
  });
});

describe("a frame unmounted", () => {
  /** The callbacks waiting for the next frame, which `nextFrame` runs. */
  const waiting: (() => void)[] = [];
  const nextFrame = () => {
    for (const callback of waiting.splice(0)) {
      callback();
    }
  };
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
      waiting.push(callback)
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    waiting.length = 0;
  });

  it("gives its host back with nothing of the frame's on it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events: {},
      frame: "a",
      shown: { className: "block", style: "left: 4px", title: "Home" },
      still: true,
    });
    page(() => undefined);
    runtime.render({
      defaults: { theme: "dark" },
      designSystem: null,
      mode: "fit",
      renderId: 1,
      root: null,
    });
    expect(host.getAttributeNames()).toEqual(
      expect.arrayContaining(["data-ed-drawn", "data-ed-fit", "data-ed-still"])
    );
    runtime.unmount();
    expect(host.getAttributeNames()).toEqual([]);
    expect(host.shadowRoot?.childNodes).toHaveLength(0);
    expect(host.shadowRoot?.adoptedStyleSheets).toEqual([]);
  });

  it("leaves what is pressed in its host alone", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const events = { navigateTo: vi.fn(), pressed: vi.fn() };
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events,
      frame: "a",
      shown: { interactive: true },
    });
    const press = () => {
      const link = document.createElement("a");
      link.href = "/pricing";
      host.shadowRoot?.append(link);
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      link.dispatchEvent(click);
      return click;
    };
    expect(press().defaultPrevented).toBe(true);
    expect(events.navigateTo).toHaveBeenCalledTimes(1);
    expect(events.pressed).toHaveBeenCalledTimes(1);
    runtime.unmount();
    expect(press().defaultPrevented).toBe(false);
    expect(events.navigateTo).toHaveBeenCalledTimes(1);
    expect(events.pressed).toHaveBeenCalledTimes(1);
  });

  it("says nothing more: a measure waiting for the next frame is dropped", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const events = { rects: vi.fn(), size: vi.fn() };
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events,
      frame: "a",
    });
    page(() => undefined);
    runtime.render({
      designSystem: null,
      mode: "fit",
      renderId: 1,
      root: null,
    });
    runtime.watchRects(["n"]);
    runtime.unmount();
    nextFrame();
    expect(events.rects).not.toHaveBeenCalled();
    expect(events.size).not.toHaveBeenCalled();
  });
});

describe("a frame's error", () => {
  it("is the page's when its renderer reports it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const error = vi.fn();
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events: { error },
      frame: "a",
    });
    opened.push(runtime);
    page((setup) => setup.reportError({ message: "drawn badly" }));
    runtime.render({
      designSystem: null,
      mode: "page",
      renderId: 1,
      root: null,
    });
    expect(error).toHaveBeenLastCalledWith({
      message: "drawn badly",
    });
    page(() => undefined);
  });
});

describe("the design's look (ADR 0042)", () => {
  const sheetText = (sheet: CSSStyleSheet | undefined) =>
    Array.from(sheet?.cssRules ?? [])
      .map((rule) => rule.cssText)
      .join("\n");
  const card = {
    base: {},
    name: "Card",
    origin: "system",
    states: {},
    variants: {},
    version: 1,
  } as const;

  it("is written once for every frame, which draw again with its components", () => {
    const a = open("a", "light");
    const b = open("b", "light");
    const drawn: string[] = [];
    a.draw((_setup, drawing) =>
      drawn.push(`a:${drawing.components.map((c) => c.name).join(",")}`)
    );
    b.runtime.render({
      designSystem: null,
      mode: "page",
      renderId: 2,
      root: null,
    });
    drawn.length = 0;
    preview.setLook({ components: [card], css: ":root { --x: 1px; }" });
    expect(drawn).toEqual(["a:Card", "a:Card"]);
    const [sheetA, sheetB] = [a, b].map((f) =>
      f.host.shadowRoot?.adoptedStyleSheets.at(-1)
    );
    expect(sheetA).toBe(sheetB);
    expect(sheetText(sheetA)).toContain("--x: 1px");
  });
});
