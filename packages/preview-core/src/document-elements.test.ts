// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type FrameElements,
  guardDocumentElements,
} from "./document-elements.ts";

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

const frame = (): FrameElements => {
  const host = document.createElement("div");
  host.className = "absolute editor-placed";
  host.style.left = "40px";
  const body = document.createElement("div");
  body.className = "light";
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
});
