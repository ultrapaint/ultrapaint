// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type FrameElements,
  guardDocumentElements,
} from "./document-elements.ts";
import { writeClasses, writeStyle } from "./frame-host.ts";

/** The frame whose code calls, or null for the editor's: the tests say so instead of a stack. */
let calling: FrameElements | null = null;
const asFrame = <T>(elements: FrameElements, f: () => T): T => {
  calling = elements;
  try {
    return f();
  } finally {
    calling = null;
  }
};

beforeAll(() => guardDocumentElements(() => calling));

/** A frame's elements, as the editor shows them. */
const frame = (): FrameElements => {
  const host = document.createElement("div");
  writeClasses(host, "editor", ["absolute", "editor-placed"]);
  writeStyle(host, "editor", "left: 40px");
  const body = document.createElement("div");
  writeClasses(body, "editor", ["light"]);
  writeStyle(body, "editor", { background: "white" });
  return { body, host };
};

beforeEach(() => {
  document.documentElement.className = "";
  document.body.removeAttribute("style");
});

describe("the page's <html>", () => {
  it("is its frame's: a theme class on the host and the frame's body", () => {
    const a = frame();
    asFrame(a, () => document.documentElement.classList.add("dark"));
    expect(a.host.classList.contains("dark")).toBe(true);
    expect(a.body.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(
      asFrame(a, () => document.documentElement.classList.contains("dark"))
    ).toBe(true);
  });

  it("replaces its own classes, never the editor's on the host", () => {
    const a = frame();
    asFrame(a, () => {
      document.documentElement.className = "dark";
      document.documentElement.className = "light-x";
    });
    expect([...a.host.classList]).toEqual([
      "absolute",
      "editor-placed",
      "light-x",
    ]);
  });

  it("styles the host, but never writes its whole style", () => {
    const a = frame();
    asFrame(a, () => {
      document.documentElement.style.colorScheme = "dark";
      document.documentElement.setAttribute("style", "overflow: hidden");
    });
    expect(a.host.style.colorScheme).toBe("dark");
    expect(a.host.style.left).toBe("40px");
    expect(document.documentElement.style.colorScheme).toBe("");
  });

  it("keeps the page's classes and style when the editor changes its own", () => {
    const a = frame();
    asFrame(a, () => {
      document.documentElement.classList.add("dark");
      document.documentElement.style.setProperty("color-scheme", "dark");
    });
    writeClasses(a.host, "editor", ["relative"]);
    writeStyle(a.host, "editor", "top: 2px");
    expect([...a.host.classList].sort()).toEqual(["dark", "relative"]);
    expect(a.host.style.colorScheme).toBe("dark");
    expect(a.host.style.left).toBe("");
    expect(a.host.style.top).toBe("2px");
    // The page's class that is the editor's too stays the editor's.
    writeClasses(a.body, "editor", ["dark"]);
    asFrame(a, () => document.documentElement.classList.remove("dark"));
    expect(a.host.classList.contains("dark")).toBe(false);
    expect(a.body.classList.contains("dark")).toBe(true);
  });

  it("toggles its class attribute as the DOM does, never as a class", () => {
    const a = frame();
    asFrame(a, () => {
      document.documentElement.classList.add("dark");
      expect(document.documentElement.toggleAttribute("class", true)).toBe(
        true
      );
    });
    expect([...a.host.classList]).toEqual([
      "absolute",
      "editor-placed",
      "dark",
    ]);
    expect(a.body.classList.contains("true")).toBe(false);
    expect(
      asFrame(a, () => document.documentElement.toggleAttribute("class", false))
    ).toBe(false);
    expect([...a.host.classList]).toEqual(["absolute", "editor-placed"]);
    expect([...a.body.classList]).toEqual(["light"]);
  });

  it("toggles an attribute on the host and the body alike", () => {
    const a = frame();
    a.host.setAttribute("data-mode", "");
    expect(
      asFrame(a, () => document.documentElement.toggleAttribute("data-mode"))
    ).toBe(true);
    expect(a.host.hasAttribute("data-mode")).toBe(true);
    expect(a.body.hasAttribute("data-mode")).toBe(true);
  });

  it("is the editor's when the editor writes it", () => {
    document.documentElement.classList.add("editor-dark");
    expect(document.documentElement.classList.contains("editor-dark")).toBe(
      true
    );
  });
});

describe("the page's <body>", () => {
  it("is its frame's body: a scroll lock locks the frame, not the editor", () => {
    const a = frame();
    asFrame(a, () => {
      document.body.style.overflow = "hidden";
      document.body.setAttribute("data-scroll-locked", "1");
    });
    expect(a.body.style.overflow).toBe("hidden");
    expect(a.body.getAttribute("data-scroll-locked")).toBe("1");
    expect(document.body.style.overflow).toBe("");
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  });

  it("keeps its style when its style attribute is toggled on", () => {
    const a = frame();
    asFrame(a, () => {
      document.body.style.overflow = "hidden";
      expect(document.body.toggleAttribute("style", true)).toBe(true);
    });
    expect(a.body.style.overflow).toBe("hidden");
    asFrame(a, () => document.body.toggleAttribute("style", false));
    expect(a.body.style.overflow).toBe("");
    expect(a.body.style.background).toBe("white");
  });

  it("is the page's whole style on the frame's body, the editor's left", () => {
    const a = frame();
    asFrame(a, () => {
      document.body.style.overflow = "hidden";
      document.body.setAttribute("style", "padding-right: 15px");
    });
    expect(a.body.style.overflow).toBe("");
    expect(a.body.style.paddingRight).toBe("15px");
    expect(a.body.style.background).toBe("white");
    asFrame(a, () => document.body.removeAttribute("style"));
    expect(a.body.style.paddingRight).toBe("");
    expect(a.body.style.background).toBe("white");
  });
});
