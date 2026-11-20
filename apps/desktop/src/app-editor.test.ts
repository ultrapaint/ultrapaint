import { describe, expect, it } from "vitest";
import { isAppPage } from "./app-editor.ts";

describe("isAppPage", () => {
  it("is the app's own pages and its servers on this machine, and nothing else", () => {
    expect(isAppPage("ultrapaint://app/tabs.html")).toBe(true);
    expect(isAppPage("ultrapaint://app/?canvas=redesign")).toBe(true);
    expect(isAppPage("http://127.0.0.1:45279/")).toBe(true);
    expect(isAppPage("http://localhost:4770/vibe")).toBe(true);
    // A redirect elsewhere, another host of the scheme, a page of another machine.
    expect(isAppPage("https://example.com/")).toBe(false);
    expect(isAppPage("ultrapaint://evil/")).toBe(false);
    expect(isAppPage("http://192.168.1.4:4770/")).toBe(false);
    expect(isAppPage("http://127.0.0.1.example.com/")).toBe(false);
    expect(isAppPage("")).toBe(false);
    expect(isAppPage("about:blank")).toBe(false);
  });
});
