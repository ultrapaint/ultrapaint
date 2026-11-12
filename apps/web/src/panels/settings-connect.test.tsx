// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { InstalledCommand } from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { McpConnectionGroup, OUTSIDE_COMMANDS } from "./settings-agents.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

/** The desktop app's command, as its shell answers for it. */
const withCommand = (
  installed: InstalledCommand | null,
  install: () => Promise<InstalledCommand>
) =>
  setPlatform({
    command: { install, installed: () => Promise.resolve(installed) },
    serverUrl: "ws://127.0.0.1:1/ws",
  } as Platform);

const render = async () => {
  act(() => mounted.render(<McpConnectionGroup />));
  await act(() => fakeApi.requested("mcp.connection"));
};

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("mcp.connection", () => ({
    enabled: true,
    header: "x-ultrapaint-token",
    token: "mcp_x",
    url: "http://127.0.0.1:1/mcp",
  }));
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  setPlatform(null);
});

describe("Settings › Agents › Connect over MCP (ADR 0083)", () => {
  it("shows the one-time lines, the same for every project, with no port or token", async () => {
    await render();
    for (const { command } of OUTSIDE_COMMANDS) {
      expect(container.textContent).toContain(command);
    }
    expect(container.textContent).not.toContain("mcp_x");
  });

  it("installs the command where the desktop app has none, and says when its folder is not on the PATH", async () => {
    let resolve: (value: InstalledCommand) => void = () => undefined;
    withCommand(
      null,
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await render();
    await act(() => Promise.resolve());
    act(() => button("Install the command")?.click());
    await act(async () => {
      resolve({
        onPath: false,
        ours: true,
        path: "/home/u/.local/bin/ultrapaint",
      });
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "Installed in /home/u/.local/bin/ultrapaint, a folder not on your PATH yet"
    );
  });

  it("says nothing more where the command is there already", async () => {
    withCommand(
      { onPath: true, ours: false, path: "/home/u/.local/bin/ultrapaint" },
      () => Promise.reject(new Error("not asked"))
    );
    await render();
    await act(() => Promise.resolve());
    expect(button("Install the command")).toBeUndefined();
  });
});
