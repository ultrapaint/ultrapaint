import "./testing/fake-browser.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platform, setPlatform } from "./platform.ts";
import { shellStatusText } from "./state/shell-status.ts";

vi.mock(
  "./state/connection.ts",
  async () => (await import("./testing/fake-api.ts")).connectionModule
);

const globals = globalThis as Record<string, unknown>;

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
    expect(browser.projects).toBeUndefined();
    expect(browser.notices).toBeUndefined();
  });

  it("takes what a shell's preload gives", async () => {
    globals.ultrapaintPlatform = {
      notices: () =>
        Promise.resolve([
          {
            detail: "Install it.",
            id: "node",
            title: "Node.js is not installed",
          },
        ]),
      pickFolder: () => Promise.resolve("/Users/someone/Ultrapaint/Shop"),
      serverUrl: "ws://127.0.0.1:60000/ws",
    };
    const shell = platform();
    expect(shell.serverUrl).toBe("ws://127.0.0.1:60000/ws");
    expect(await shell.pickFolder?.()).toBe("/Users/someone/Ultrapaint/Shop");
    expect((await shell.notices?.())?.map((n) => n.id)).toEqual(["node"]);
  });

  it("reads the shell's status by value, however often its bridge copies it", () => {
    let status: { message: string; detail?: string } | null = null;
    const source = {
      // A bridge hands out a new copy on every read.
      current: () => (status ? { ...status } : null),
      subscribe: () => () => undefined,
    };
    expect(shellStatusText(source)).toBe("null");
    status = {
      detail: "Connection refused",
      message: "Reconnecting to devbox…",
    };
    expect(shellStatusText(source)).toBe(shellStatusText(source));
    expect(JSON.parse(shellStatusText(source))).toEqual(status);
    expect(shellStatusText()).toBe("null");
  });
});
