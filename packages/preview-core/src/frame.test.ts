// @vitest-environment happy-dom
import type {
  FrameRuntime,
  FrameShown,
} from "@ultrapaint/framework-api/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_ATTRIBUTE } from "./frame-css.ts";
import { scriptedPreview } from "./testing.ts";

const { asPage, page, preview } = scriptedPreview();

const opened: FrameRuntime[] = [];
const added: (() => void)[] = [];
afterEach(() => {
  for (const runtime of opened.splice(0)) {
    runtime.unmount();
  }
  for (const remove of added.splice(0)) {
    remove();
  }
  document.body.replaceChildren();
});

/** A frame of the canvas, mounted and shown as `shown` (taking input), drawn in `theme`. */
const open = (
  name: string,
  theme: "dark" | "light",
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
  /** The editor draws the frame; `code` is what its page's code does meanwhile. */
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

/** A listener the page's code puts on the document, taken off after the test. */
const pageListener = (type: string) => {
  const heard = vi.fn();
  asPage(() => document.addEventListener(type, heard));
  added.push(() => asPage(() => document.removeEventListener(type, heard)));
  return heard;
};

const key = (target: EventTarget) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, composed: true, key: "/" })
  );

const dark = () =>
  asPage(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

interface Seen {
  readonly dark: boolean;
  readonly popup: HTMLElement;
}

const popup = () => {
  const element = document.createElement("div");
  asPage(() => document.body.appendChild(element));
  return element;
};

describe("a frame's turn", () => {
  it("is where its page's popups, media queries, listeners and timers go, together", async () => {
    const told: string[] = [];
    added.push(preview.onRunning((frame) => told.push(frame)));
    const a = open("a", "dark");
    const b = open("b", "light");
    let heard = vi.fn();
    /** What the page's code was answered, drawn in a, in b, and in a's timer. */
    const seen: { a?: Seen; b?: Seen; timer?: Promise<Seen> } = {};
    a.draw((setup) => {
      setup.drawing();
      seen.a = { dark: dark(), popup: popup() };
      heard = pageListener("keydown");
      seen.timer = new Promise((resolve) => {
        asPage(() =>
          setTimeout(() => resolve({ dark: dark(), popup: popup() }), 0)
        );
      });
    });
    b.draw((setup) => {
      setup.drawing();
      seen.b = { dark: dark(), popup: popup() };
    });

    expect(seen.a?.dark).toBe(true);
    expect(seen.a?.popup.parentNode).toBe(a.body);
    expect(seen.b?.dark).toBe(false);
    expect(seen.b?.popup.parentNode).toBe(b.body);
    // b drew since: a's timer still runs as a's.
    const fromTimer = await seen.timer;
    expect(fromTimer?.dark).toBe(true);
    expect(fromTimer?.popup.parentNode).toBe(a.body);
    key(b.body);
    expect(heard).not.toHaveBeenCalled();
    key(a.body);
    expect(heard).toHaveBeenCalledOnce();
    expect(told.slice(0, 3)).toEqual(["a", "b", "a"]);
  });

  it("is the frame the editor drew last, for its popups and its guards alike", () => {
    const a = open("a", "dark");
    const b = open("b", "light");
    a.draw((setup) => setup.drawing());
    // A renderer that draws later says nothing as it is asked to: the frame drawn is b already.
    b.draw(() => undefined);
    const heard = pageListener("keydown");
    const shown = popup();
    expect(shown.parentNode).toBe(b.body);
    expect(dark()).toBe(false);
    asPage(() => history.pushState(null, "", "/next"));
    expect(b.navigateTo).toHaveBeenCalledWith("/next", false);
    expect(a.navigateTo).not.toHaveBeenCalled();
    key(a.body);
    expect(heard).not.toHaveBeenCalled();
    key(b.body);
    expect(heard).toHaveBeenCalledOnce();
  });

  it("is nobody's once the frame went: a popup stays on the editor's body", () => {
    const a = open("a", "dark");
    a.draw((setup) => setup.drawing());
    for (const runtime of opened.splice(0)) {
      runtime.unmount();
    }
    const shown = popup();
    expect(shown.parentNode).toBe(document.body);
    expect(dark()).toBe(
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });
});

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

  it("keeps what the page's code put on its <html> when the editor shows it again", () => {
    const { draw, host, runtime } = open("a", "light", {
      className: "block",
      style: "width: 10px",
    });
    draw(() =>
      asPage(() => {
        document.documentElement.classList.add("dark");
        document.documentElement.style.colorScheme = "dark";
      })
    );
    runtime.show({ className: "block bg-white", style: "width: 20px" });
    expect([...host.classList].sort()).toEqual(["bg-white", "block", "dark"]);
    expect(host.style.colorScheme).toBe("dark");
    expect(host.style.width).toBe("20px");
    // The page's code takes its own off, and only its own.
    draw(() =>
      asPage(() => {
        document.documentElement.className = "";
        document.documentElement.style.removeProperty("color-scheme");
      })
    );
    expect([...host.classList].sort()).toEqual(["bg-white", "block"]);
    expect(host.style.colorScheme).toBe("");
    expect(host.style.width).toBe("20px");
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

describe("a frame's error", () => {
  it("is the page's when its renderer reports it, the dev server's when the preview is told", () => {
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
      source: "page",
    });
    page(() => undefined);
    preview.reportError({ file: "/src/a.tsx", line: 2, message: "Unexpected" });
    expect(error).toHaveBeenLastCalledWith({
      file: "/src/a.tsx",
      line: 2,
      message: "Unexpected",
      source: "dev-server",
    });
  });
});
