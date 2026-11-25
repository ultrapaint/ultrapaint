// @vitest-environment happy-dom

import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { themeSelector } from "@ultrapaint/contracts/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameRuntime, FrameShown } from "./preview.ts";
import { NODE_ATTRIBUTE } from "./preview.ts";
import { BODY_ATTRIBUTE } from "./styles.ts";
import { scriptedPreview } from "./testing.ts";

const { page, preview } = scriptedPreview();

const opened: FrameRuntime[] = [];
afterEach(() => {
  for (const runtime of opened.splice(0)) {
    runtime.unmount();
  }
  getSelection()?.removeAllRanges();
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

/** A frame shown as `shown`, holding one text, node `t`: "IT Admin". */
const framedText = (shown: Partial<FrameShown> = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  const textCommit = vi.fn();
  const runtime = preview.mountFrame(host, {
    canvas: "canvas",
    events: { textCommit },
    frame: "a",
    shown,
  });
  opened.push(runtime);
  const title = document.createElement("h1");
  title.setAttribute(NODE_ATTRIBUTE, "t");
  title.textContent = "IT Admin";
  host.shadowRoot?.querySelector(`[${BODY_ATTRIBUTE}]`)?.append(title);
  return { host, runtime, textCommit, title };
};

/** The browser's selection on `el`'s words, as a drag over them leaves it. */
const selectWords = (el: Node) =>
  highlight((range) => range.selectNodeContents(el));

/** The browser's highlight, set to the range `pick` makes. */
const highlight = (pick: (range: Range) => void) => {
  const range = document.createRange();
  pick(range);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(range);
};

describe("a text edited in place", () => {
  it("takes the pointer and no focus ring until the edit ends, and says what is edited", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const textEditing = vi.fn();
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events: { textEditing },
      frame: "a",
      shown: {},
    });
    opened.push(runtime);
    const title = document.createElement("h1");
    title.setAttribute(NODE_ATTRIBUTE, "t");
    title.style.outline = "1px solid red";
    title.textContent = "Awaiting your decision";
    host.shadowRoot?.querySelector(`[${BODY_ATTRIBUTE}]`)?.append(title);
    expect(host.style.pointerEvents).toBe("none");
    const own = title.style.outline;

    runtime.editText("t");
    expect(textEditing).toHaveBeenLastCalledWith("t");
    expect(host.style.pointerEvents).toBe("auto");
    expect(title.style.outlineStyle).toBe("none");

    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(textEditing).toHaveBeenLastCalledWith(null);
    expect(host.style.pointerEvents).toBe("none");
    expect(title.style.outline).toBe(own);
  });

  it("has its words selected while edited", () => {
    const { runtime } = framedText();
    runtime.editText("t");
    expect(getSelection()?.toString()).toBe("IT Admin");
  });

  it("leaves no highlight once committed", () => {
    const { runtime, title } = framedText();
    runtime.editText("t");
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("leaves no highlight once cancelled", () => {
    const { runtime, title } = framedText();
    runtime.editText("t");
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("leaves no highlight when the frame stops taking input", () => {
    const { runtime } = framedText();
    runtime.editText("t");
    runtime.show({ interactive: false });
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("is ended by the editor keeping what was typed, and leaves no highlight", () => {
    const { runtime, textCommit, title } = framedText();
    runtime.editText("t");
    title.textContent = "IT Support";
    runtime.endTextEdit();
    expect(textCommit).toHaveBeenCalledWith("t", "IT Support");
    expect(title.hasAttribute("contenteditable")).toBe(false);
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("leaves no highlight the browser reports at the host's place, as it does one made with the mouse", () => {
    const { host, runtime } = framedText();
    runtime.editText("t");
    highlight((range) => range.selectNode(host));
    runtime.endTextEdit();
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("leaves the browser's selection outside its frame alone as it ends: the field the person went to", () => {
    const { runtime } = framedText();
    runtime.editText("t");
    const field = document.createElement("p");
    field.textContent = "A panel's words";
    document.body.append(field);
    selectWords(field);
    runtime.endTextEdit();
    expect(getSelection()?.toString()).toBe("A panel's words");
  });
});

describe("a frame's page selected in as it runs", () => {
  it("leaves no highlight once the frame is a picture again", () => {
    const { runtime, title } = framedText({ interactive: true });
    selectWords(title);
    runtime.show({ interactive: true, title: "Home" });
    expect(getSelection()?.toString()).toBe("IT Admin");
    runtime.show({ interactive: false });
    expect(getSelection()?.rangeCount).toBe(0);
  });
});

describe("a text cut to its lines, edited in place", () => {
  const cutText = (style: string) => {
    const host = document.createElement("div");
    document.body.append(host);
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events: {},
      frame: "a",
      shown: {},
    });
    opened.push(runtime);
    const name = document.createElement("p");
    name.setAttribute(NODE_ATTRIBUTE, "t");
    name.style.cssText = style;
    name.textContent = "A long name cut to one line";
    host.shadowRoot?.querySelector(`[${BODY_ATTRIBUTE}]`)?.append(name);
    return { name, runtime };
  };
  const ONE_LINE =
    "margin: 0px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";

  it("shows every word while edited, and is cut again once the edit is cancelled", () => {
    const { name, runtime } = cutText(ONE_LINE);
    runtime.editText("t");
    expect(name.style.whiteSpace).toBe("pre-wrap");
    expect(name.style.overflow).toBe("visible");
    expect(name.style.textOverflow).toBe("clip");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(name.style.cssText).toBe(ONE_LINE);
  });

  it("is cut again once the edit is committed", () => {
    const { name, runtime } = cutText(ONE_LINE);
    runtime.editText("t");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(name.style.cssText).toBe(ONE_LINE);
  });
  // A clamp (`-webkit-line-clamp`) is lifted the same way; happy-dom keeps no `-webkit-` style.
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

describe("a frame's watched nodes", () => {
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

  it("are measured again as a box inside the page scrolls, which the host never hears", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const rects = vi.fn();
    const runtime = preview.mountFrame(host, {
      canvas: "canvas",
      events: { rects },
      frame: "a",
    });
    opened.push(runtime);
    const list = document.createElement("div");
    const item = document.createElement("p");
    item.setAttribute(NODE_ATTRIBUTE, "n");
    item.textContent = "Row";
    let top = 40;
    item.getBoundingClientRect = () => new DOMRect(0, top, 100, 20);
    list.append(item);
    host.shadowRoot?.querySelector(`[${BODY_ATTRIBUTE}]`)?.append(list);
    runtime.watchRects(["n"]);
    nextFrame();
    expect(rects).toHaveBeenCalledTimes(1);

    top = 10;
    list.dispatchEvent(new Event("scroll"));
    nextFrame();
    expect(rects).toHaveBeenCalledTimes(2);
    expect(rects.mock.lastCall?.[0].n.y).toBeLessThan(
      rects.mock.calls[0]?.[0].n.y
    );
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

  it("has every frame write its page's defaults from one reading of the design system", () => {
    let reads = 0;
    const designSystem: DesignSystem = Object.defineProperty(
      emptyDesignSystem(),
      "radius",
      {
        get: () => {
          reads += 1;
          return [];
        },
      }
    );
    const frames = [open("a", "light"), open("b", "light")];
    for (const [i, frame] of frames.entries()) {
      frame.runtime.render({
        defaults: { fill: "$color-page", theme: "light" },
        designSystem,
        mode: "page",
        renderId: i + 1,
        root: null,
      });
    }
    // A look that changes draws every frame again.
    preview.setLook({ components: [], css: "" });
    expect(frames.map((f) => f.body.style.background)).toEqual([
      "var(--color-page)",
      "var(--color-page)",
    ]);
    expect(reads).toBe(1);
  });
});
