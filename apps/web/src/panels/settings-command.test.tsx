// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { InstalledCommand } from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { CommandRow } from "./settings-agents.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

/**
 * The desktop shell, with `installed` as the `ultrapaint` command it finds (none by default);
 * Ultrapaint Dev's with `dev`.
 */
const shell = (dev: boolean, installed: InstalledCommand | null = null) =>
  setPlatform({
    command: {
      install: () => Promise.reject(new Error("not asked")),
      installed: () => Promise.resolve(installed),
    },
    ...(dev
      ? {
          dev: {
            current: () => ({ branch: "main", commit: "3f2a1c9" }),
            subscribe: () => () => undefined,
          },
        }
      : {}),
    serverUrl: "ws://localhost:4000/ws",
  } as unknown as Platform);

const render = () => act(async () => root.render(<CommandRow />));

const installButton = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === "Install");

afterEach(() => {
  act(() => root.render(null));
  setPlatform(null);
});

describe("Settings › Command line", () => {
  it("offers the release's app to install the command it lacks", async () => {
    shell(false);
    await render();
    expect(installButton()).toBeDefined();
  });

  it("leaves the command to the installed Ultrapaint in Ultrapaint Dev, offering no install", async () => {
    shell(true);
    await render();
    expect(installButton()).toBeUndefined();
    expect(host.textContent).toContain(
      "Ultrapaint Dev leaves the command to the installed Ultrapaint."
    );
  });

  it("still says where the release's command is, and that its folder isn't on the PATH, in Ultrapaint Dev", async () => {
    shell(true, {
      onPath: false,
      ours: true,
      path: "/Users/a/.local/bin/ultrapaint",
      shipped: false,
    });
    await render();
    expect(host.textContent).toContain("/Users/a/.local/bin/ultrapaint");
    expect(host.textContent).toContain("Not on your PATH");
    expect(installButton()).toBeUndefined();
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Install again"
      )
    ).toBe(false);
  });
});
