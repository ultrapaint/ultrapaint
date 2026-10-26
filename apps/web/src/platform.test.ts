import "./testing/fake-browser.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platform, setPlatform } from "./platform.ts";
import { previewUrl } from "./state/project.ts";

vi.mock(
  "./state/connection.ts",
  async () => (await import("./testing/fake-api.ts")).connectionModule
);

const globals = globalThis as Record<string, unknown>;
const running = { state: "running", url: "http://127.0.0.1:5173" } as const;

afterEach(() => {
  globals.ultrapaintPlatform = undefined;
  globals.location = undefined;
  setPlatform(null);
});

describe("the platform", () => {
  it("is the page's own in a browser: its origin, and nothing more", () => {
    globals.location = { host: "127.0.0.1:4770", protocol: "http:" };
    const browser = platform();
    expect(browser.serverUrl).toBe("ws://127.0.0.1:4770/ws");
    expect(browser.pickFolder).toBeUndefined();
    expect(browser.mapPreviewUrl).toBeUndefined();
    expect(browser.projects).toBeUndefined();
    expect(previewUrl(running)).toBe("http://127.0.0.1:5173");
  });

  it("takes what a shell's preload gives, and maps the preview through it", async () => {
    globals.ultrapaintPlatform = {
      mapPreviewUrl: (url: string) =>
        url.replace("127.0.0.1:5173", "127.0.0.1:61000"),
      pickFolder: () => Promise.resolve("/Users/someone/Ultrapaint/Shop"),
      serverUrl: "ws://127.0.0.1:60000/ws",
    };
    const shell = platform();
    expect(shell.serverUrl).toBe("ws://127.0.0.1:60000/ws");
    expect(await shell.pickFolder?.()).toBe("/Users/someone/Ultrapaint/Shop");
    expect(previewUrl(running)).toBe("http://127.0.0.1:61000");
    expect(previewUrl({ state: "starting" })).toBeNull();
  });
});
