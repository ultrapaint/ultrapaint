// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProvenance } from "./provenance.ts";
import {
  type GuardedFrame,
  guardFrame,
  installGuards,
  onStrayError,
} from "./sandbox.ts";

const ORIGIN = "http://127.0.0.1:4601";
const BASE = "/preview/";
const BUNDLE = `${ORIGIN}${BASE}@fs/ultrapaint/dist/editor.js`;
/** A module of the page's, under the base. */
const PAGE_MODULE = `${ORIGIN}${BASE}src/preview-module.tsx`;

/** Recorded stacks of whoever calls a patch, the caller first. */
const STACKS = {
  /** The editor's bundle, called by the page's code (the registry handing itself over). */
  bundle: [
    `    at setComponents (${BUNDLE}?v=3:1:2)`,
    `    at registry (${PAGE_MODULE}:3:1)`,
  ],
  editor: [`    at onKey (${ORIGIN}/assets/index.js:5:5)`],
  /** The page's code, which the editor handed a frame to draw. */
  page: [
    `    at Page (${PAGE_MODULE}:3:1)`,
    `    at renderWithHooks (${ORIGIN}${BASE}node_modules/.vite/deps/react-dom.js:9:1)`,
    `    at draw (${BUNDLE}?v=3:1:2)`,
    `    at canvas (${ORIGIN}/assets/index.js:5:5)`,
  ],
  /** The page's wrapper of a global (its logging), called by the editor's own code. */
  wrapper: [
    `    at loggedFetch (${PAGE_MODULE}:3:1)`,
    `    at api (${ORIGIN}/assets/index.js:5:5)`,
  ],
};

/** The stack the guards read: the editor's, unless a test says whose code calls. */
let calling: readonly string[] = STACKS.editor;
const as = <T>(stack: readonly string[], f: () => T): T => {
  calling = stack;
  try {
    return f();
  } finally {
    calling = STACKS.editor;
  }
};
const asPreview = <T>(f: () => T): T => as(STACKS.page, f);

/** What the guards' requests reach: the editor's `fetch`, as the window had it. */
const reached = vi.fn((_input: RequestInfo | URL) =>
  Promise.resolve(new Response(""))
);

beforeAll(() => {
  window.fetch = reached as typeof fetch;
  installGuards(
    createProvenance({
      base: BASE,
      ownScript: BUNDLE,
      readModule: () => Promise.reject(new Error("no module in a test")),
      stack: () => ["Error", ...calling].join("\n"),
    })
  );
});

/** What is told of an error is told once its line is looked up: after a turn. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const mounted: (() => void)[] = [];
afterEach(() => {
  for (const unmount of mounted.splice(0)) {
    unmount();
  }
  document.body.replaceChildren();
});

/** A frame host with a shadow root holding a button, guarded. */
const frame = (interactive = true) => {
  const host = document.createElement("div");
  host.setAttribute("data-ed-frame-host", "");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const body = document.createElement("div");
  const button = document.createElement("button");
  body.append(button);
  shadow.append(body);
  const navigate = vi.fn<GuardedFrame["navigate"]>();
  const error = vi.fn<GuardedFrame["error"]>();
  const guard = guardFrame({
    asking: () => undefined,
    body,
    error,
    host,
    interactive: () => interactive,
    navigate,
  });
  mounted.push(guard.unmount);
  return { body, button, error, guard, host, navigate };
};

const key = (target: EventTarget) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, composed: true, key: "/" })
  );

describe("listeners on the document", () => {
  it("hear the keys of their own frame, never the editor's", () => {
    const a = frame();
    const heard = vi.fn();
    a.guard.asking();
    asPreview(() => document.addEventListener("keydown", heard));
    const field = document.createElement("input");
    document.body.append(field);
    key(field);
    expect(heard).not.toHaveBeenCalled();
    key(a.button);
    expect(heard).toHaveBeenCalledTimes(1);
    asPreview(() => document.removeEventListener("keydown", heard));
    key(a.button);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("do not hear another frame's keys", () => {
    const a = frame();
    const b = frame();
    const heard = vi.fn();
    a.guard.asking();
    asPreview(() => document.addEventListener("keydown", heard));
    key(b.button);
    expect(heard).not.toHaveBeenCalled();
    asPreview(() => document.removeEventListener("keydown", heard));
  });

  it("count `once` on the frame's events only", () => {
    const a = frame();
    const heard = vi.fn();
    a.guard.asking();
    asPreview(() =>
      document.addEventListener("keydown", heard, { once: true })
    );
    key(document.body);
    key(a.button);
    key(a.button);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("are the editor's as they were when the editor adds them", () => {
    const heard = vi.fn();
    document.addEventListener("keydown", heard);
    key(document.body);
    expect(heard).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", heard);
  });
});

describe("the window", () => {
  it("never tells the preview the editor is leaving", () => {
    const heard = vi.fn();
    asPreview(() => window.addEventListener("beforeunload", heard));
    asPreview(() => {
      window.onbeforeunload = heard;
    });
    window.dispatchEvent(new Event("beforeunload"));
    expect(heard).not.toHaveBeenCalled();
    expect(window.onbeforeunload).toBeNull();
  });

  it("tells the frame's scroll, its position answered by the frame", () => {
    const a = frame();
    let seen = -1;
    const onScroll = () => {
      seen = window.scrollY;
    };
    a.guard.asking();
    asPreview(() => window.addEventListener("scroll", onScroll));
    // happy-dom lays nothing out: the host says where it scrolled to.
    Object.defineProperty(a.host, "scrollTop", { value: 120 });
    a.host.dispatchEvent(new Event("scroll"));
    expect(seen).toBe(120);
    expect(window.scrollY).toBe(0);
    asPreview(() => window.removeEventListener("scroll", onScroll));
  });

  it("scrolls the frame that takes input, never the editor", () => {
    const a = frame();
    const scrollTo = vi.spyOn(a.host, "scrollTo");
    a.guard.asking();
    asPreview(() => window.scrollTo(0, 0));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe("history", () => {
  it("is left alone, a page pushed in the prototype followed", () => {
    const a = frame();
    const before = location.href;
    a.guard.asking();
    asPreview(() => history.replaceState(null, "", "?tab=overview"));
    asPreview(() => history.pushState(null, "", "/about"));
    expect(location.href).toBe(before);
    expect(a.navigate).toHaveBeenCalledWith("/about", false);
  });

  it("is not followed from a frame that is a picture", () => {
    const a = frame(false);
    a.guard.asking();
    asPreview(() => history.pushState(null, "", "/about"));
    expect(a.navigate).not.toHaveBeenCalled();
  });
});

describe("the head", () => {
  it("keeps the page's title and meta off the editor's", () => {
    const title = document.createElement("title");
    title.textContent = "App";
    const meta = document.createElement("meta");
    const style = document.createElement("style");
    asPreview(() => {
      document.head.appendChild(title);
      document.head.insertBefore(meta, null);
      document.head.appendChild(style);
      document.title = "App";
    });
    expect(title.isConnected).toBe(false);
    expect(meta.isConnected).toBe(false);
    expect(style.isConnected).toBe(true);
    expect(document.title).not.toBe("App");
    title.remove();
    style.remove();
  });
});

describe("errors nothing caught", () => {
  const thrown = (message: string, inPreview: boolean) => {
    const error = new Error(message);
    error.stack = `Error: ${message}\n    at f (${inPreview ? PAGE_MODULE : `${ORIGIN}/assets/index.js`}:3:1)`;
    return error;
  };

  it("are told to the frame that was drawing when the preview's code threw them", async () => {
    const a = frame();
    a.guard.asking();
    window.dispatchEvent(
      new ErrorEvent("error", { error: thrown("in a timer", true) })
    );
    await settled();
    expect(a.error).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "src/preview-module.tsx",
        line: 3,
        message: "in a timer",
      })
    );
  });

  it("are left to the editor when its own code threw them", async () => {
    const a = frame();
    a.guard.asking();
    window.dispatchEvent(
      new ErrorEvent("error", { error: thrown("the editor's", false) })
    );
    await settled();
    expect(a.error).not.toHaveBeenCalled();
  });
});

describe("rejections", () => {
  /** What the guard in the repository's code calls (`virtual:ultrapaint/guard`). */
  const guard = () =>
    (
      globalThis as unknown as {
        __ultrapaintGuard: {
          frame: () => unknown;
          mark: (error: object, frame: unknown) => void;
        };
      }
    ).__ultrapaintGuard;
  const rejected = (message: string) => {
    const error = new Error(message);
    error.stack = `Error: ${message}\n    at f (${PAGE_MODULE}:3:1)`;
    return error;
  };
  const surface = (reason: unknown) =>
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason })
    );

  it("are told to the frame their async function was called for, whichever runs since", async () => {
    const a = frame();
    const b = frame();
    a.guard.asking();
    const called = guard().frame();
    const error = rejected("in a");
    b.guard.asking();
    guard().mark(error, called);
    surface(error);
    await settled();
    expect(a.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "in a" })
    );
    expect(b.error).not.toHaveBeenCalled();
  });

  it("are told to no frame when nothing says which", async () => {
    const a = frame();
    const b = frame();
    a.guard.asking();
    const stray = vi.fn();
    const stop = onStrayError(stray);
    surface(rejected("in a chain"));
    await settled();
    stop();
    expect(stray).toHaveBeenCalledWith(
      expect.objectContaining({ message: "in a chain" })
    );
    expect(a.error).not.toHaveBeenCalled();
    expect(b.error).not.toHaveBeenCalled();
  });

  it("are the one frame's when only one is drawn", async () => {
    const a = frame();
    surface(rejected("alone"));
    await settled();
    expect(a.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "alone" })
    );
  });
});

describe("timers", () => {
  it("run as the frame whose code set them, whichever drew since", async () => {
    const a = frame();
    const b = frame();
    a.guard.asking();
    const failure = new Error("in a timer");
    failure.stack = `Error: in a timer\n    at f (${PAGE_MODULE}:3:1)`;
    const thrown = new Promise<void>((resolve) => {
      asPreview(() =>
        setTimeout(() => {
          window.dispatchEvent(new ErrorEvent("error", { error: failure }));
          resolve();
        }, 0)
      );
    });
    b.guard.asking();
    await thrown;
    await settled();
    expect(a.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "in a timer" })
    );
    expect(b.error).not.toHaveBeenCalled();
  });
});

describe("each guard's rule", () => {
  it("a listener the editor's bundle adds for the page's code is the page's", () => {
    const a = frame();
    const heard = vi.fn();
    a.guard.asking();
    as(STACKS.bundle, () => document.addEventListener("keydown", heard));
    key(document.body);
    expect(heard).not.toHaveBeenCalled();
    key(a.button);
    expect(heard).toHaveBeenCalledTimes(1);
    as(STACKS.bundle, () => document.removeEventListener("keydown", heard));
  });

  it("a timer the editor's bundle sets is the editor's, though the page's code called it", async () => {
    const a = frame();
    const b = frame();
    a.guard.asking();
    const failure = new Error("in the editor's timer");
    failure.stack = `Error: in the editor's timer\n    at f (${PAGE_MODULE}:3:1)`;
    const thrown = new Promise<void>((resolve) => {
      as(STACKS.bundle, () =>
        setTimeout(() => {
          window.dispatchEvent(new ErrorEvent("error", { error: failure }));
          resolve();
        }, 0)
      );
    });
    b.guard.asking();
    await thrown;
    await settled();
    // Not run as a's: the error goes to the frame asked about last.
    expect(a.error).not.toHaveBeenCalled();
    expect(b.error).toHaveBeenCalledOnce();
  });

  it("a request is the page's by the whole stack, the editor's through the page's wrapper", () => {
    as(STACKS.page, () => window.fetch("/api/health"));
    expect(reached.mock.lastCall?.[0]).toBe(
      `${location.origin}/preview/api/health`
    );
    as(STACKS.wrapper, () => window.fetch("/api/health"));
    expect(reached.mock.lastCall?.[0]).toBe("/api/health");
  });

  it("storage is the page's own when its code asks, the editor's when the bundle does", () => {
    as(STACKS.page, () => window.localStorage.setItem("theme", "dark"));
    expect(window.localStorage.getItem("theme")).toBeNull();
    expect(as(STACKS.page, () => window.localStorage.getItem("theme"))).toBe(
      "dark"
    );
    expect(
      as(STACKS.bundle, () => window.localStorage.getItem("theme"))
    ).toBeNull();
  });

  it("a write to <html> is its frame's when the page's code writes, the editor's when the bundle does", () => {
    const a = frame();
    a.guard.asking();
    const html = document.documentElement;
    as(STACKS.page, () => html.classList.add("dark"));
    expect(a.host.classList.contains("dark")).toBe(true);
    expect(html.classList.contains("dark")).toBe(false);
    as(STACKS.bundle, () => html.classList.add("dragging"));
    expect(html.classList.contains("dragging")).toBe(true);
    expect(a.host.classList.contains("dragging")).toBe(false);
    html.classList.remove("dragging");
  });
});
