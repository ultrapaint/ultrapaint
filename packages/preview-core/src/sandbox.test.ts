// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type GuardedFrame, guardFrame, installGuards } from "./sandbox.ts";

/** Whether the code calling is the preview's: the tests say so instead of a stack. */
let preview = false;
const asPreview = <T>(f: () => T): T => {
  preview = true;
  try {
    return f();
  } finally {
    preview = false;
  }
};

/** An error is the preview's when its stack names this file, as a module under the base would. */
beforeAll(() =>
  installGuards({
    caller: () => preview,
    thrown: (stack) =>
      stack?.includes("preview-module.tsx")
        ? { file: "src/preview-module.tsx", line: 3 }
        : null,
  })
);

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
  const button = document.createElement("button");
  shadow.append(button);
  const navigate = vi.fn<GuardedFrame["navigate"]>();
  const error = vi.fn<GuardedFrame["error"]>();
  const guard = guardFrame({
    asking: () => undefined,
    error,
    host,
    interactive: () => interactive,
    navigate,
  });
  mounted.push(guard.unmount);
  return { button, error, guard, host, navigate };
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
    error.stack = `Error: ${message}\n    at f (http://x/${inPreview ? "preview-module.tsx" : "editor.tsx"}:3:1)`;
    return error;
  };

  it("are told to the frame that was drawing when the preview's code threw them", () => {
    const a = frame();
    a.guard.asking();
    window.dispatchEvent(
      new ErrorEvent("error", { error: thrown("in a timer", true) })
    );
    expect(a.error).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "src/preview-module.tsx",
        line: 3,
        message: "in a timer",
      })
    );
  });

  it("are left to the editor when its own code threw them", () => {
    const a = frame();
    a.guard.asking();
    window.dispatchEvent(
      new ErrorEvent("error", { error: thrown("the editor's", false) })
    );
    expect(a.error).not.toHaveBeenCalled();
  });
});

describe("timers", () => {
  it("run as the frame whose code set them, whichever drew since", async () => {
    const a = frame();
    const b = frame();
    a.guard.asking();
    const failure = new Error("in a timer");
    failure.stack =
      "Error: in a timer\n    at f (http://x/preview-module.tsx:3:1)";
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
    expect(a.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "in a timer" })
    );
    expect(b.error).not.toHaveBeenCalled();
  });
});
