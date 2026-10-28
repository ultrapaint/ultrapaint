// @vitest-environment happy-dom
import type {
  FrameRuntime,
  RenderSetup,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPreview } from "./frame.ts";
import { BODY_ATTRIBUTE } from "./frame-css.ts";
import { install } from "./kernel.ts";

const ORIGIN = "http://127.0.0.1:4601";
const BASE = "/preview/";
const BUNDLE = `${ORIGIN}${BASE}@fs/ultrapaint/dist/editor.js`;
const PAGE_MODULE = `${ORIGIN}${BASE}src/preview-module.tsx`;

/** Recorded stacks of whoever calls a patch, the caller first. */
const STACKS = {
  editor: [`    at onKey (${ORIGIN}/assets/index.js:5:5)`],
  page: [
    `    at Page (${PAGE_MODULE}:3:1)`,
    `    at draw (${BUNDLE}?v=3:1:2)`,
    `    at canvas (${ORIGIN}/assets/index.js:5:5)`,
  ],
};

/** The stack the guards read: the editor's, unless the page's code runs. */
let calling: readonly string[] = STACKS.editor;
const asPage = <T>(f: () => T): T => {
  calling = STACKS.page;
  try {
    return f();
  } finally {
    calling = STACKS.editor;
  }
};

/** What the page's code does when its frame is drawn: each test's. */
let page: (setup: RenderSetup) => void = () => undefined;
/** A renderer that runs the test's page code when asked to draw. */
const mount: RenderToCanvas = (setup) => ({
  render: () => page(setup),
  setComponents: () => undefined,
  unmount: () => undefined,
});

let preview: ReturnType<typeof createPreview>;
beforeAll(() => {
  install({
    base: BASE,
    ownScript: BUNDLE,
    readModule: () => Promise.reject(new Error("no module in a test")),
    stack: () => ["Error", ...calling].join("\n"),
  });
  preview = createPreview(mount, {
    assets: `${ORIGIN}${BASE}@assets`,
    components: {},
    designsRoot: `${ORIGIN}${BASE}@fs/designs`,
    providers: undefined,
    theme: "light",
  });
});

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

/** A frame of the canvas, mounted and taking input, drawn in `theme`. */
const open = (name: string, theme: "dark" | "light") => {
  const host = document.createElement("div");
  document.body.append(host);
  const navigateTo = vi.fn();
  const runtime = preview.mountFrame(host, {
    canvas: "canvas",
    events: { navigateTo },
    frame: name,
  });
  opened.push(runtime);
  runtime.setInteractive(true);
  const body = host.shadowRoot?.querySelector(
    `[${BODY_ATTRIBUTE}]`
  ) as HTMLElement;
  /** The editor draws the frame; `code` is what its page's code does meanwhile. */
  const draw = (code: (setup: RenderSetup) => void) => {
    page = code;
    runtime.render({
      defaults: { theme },
      designSystem: null,
      mode: "page",
      renderId: 1,
      root: null,
    });
  };
  return { body, draw, navigateTo };
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
