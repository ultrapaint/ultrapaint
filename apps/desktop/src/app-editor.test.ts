import { describe, expect, it } from "vitest";
import { APP_ORIGIN, onOrigin, originOf } from "./app-editor.ts";

describe("a view's origin", () => {
  it("is the app's own scheme and host, or a server's scheme, host and port", () => {
    expect(originOf("ultrapaint://app/tabs.html")).toBe(APP_ORIGIN);
    expect(originOf("http://127.0.0.1:45279/vibe?x=1")).toBe(
      "http://127.0.0.1:45279"
    );
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("")).toBeNull();
  });

  it("lets a view show only the origin given it: no other port, host or scheme", () => {
    const server = "http://127.0.0.1:45279";
    expect(onOrigin("http://127.0.0.1:45279/canvas", server)).toBe(true);
    expect(onOrigin("http://127.0.0.1:6006/", server)).toBe(false);
    expect(onOrigin("http://localhost:45279/", server)).toBe(false);
    expect(onOrigin("ultrapaint://app/", server)).toBe(false);
    expect(onOrigin("ultrapaint://app/welcome.html", APP_ORIGIN)).toBe(true);
    expect(onOrigin("ultrapaint://evil/", APP_ORIGIN)).toBe(false);
    expect(onOrigin("https://example.com/", APP_ORIGIN)).toBe(false);
    // A view given none (the window's own page) shows nothing.
    expect(onOrigin("ultrapaint://app/", undefined)).toBe(false);
  });
});
