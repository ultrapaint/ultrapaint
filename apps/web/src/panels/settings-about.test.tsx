// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  AppUpdate,
  NodeStatus,
  UpdateCheck,
} from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { AboutSection } from "./settings-about.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

const UPDATE: AppUpdate = {
  current: "0.2.0",
  install: "restart",
  releases: [{ date: "2026-11-18T11:22:14Z", notes: "", version: "0.3.0" }],
  url: "https://github.com/ultrapaint/ultrapaint/releases/tag/v0.3.0",
};

/**
 * The desktop shell, with `update` as its last check left it and a check asked now that answers
 * when the test says.
 */
const shell = (update: AppUpdate | null) => {
  let answer: (found: UpdateCheck) => void = () => undefined;
  const asked: string[] = [];
  setPlatform({
    checkUpdate: () => {
      asked.push("check");
      return new Promise<UpdateCheck>((resolve) => {
        answer = resolve;
      });
    },
    serverUrl: "ws://localhost:4000/ws",
    update: {
      current: () => update,
      subscribe: () => () => undefined,
    },
  } as unknown as Platform);
  return { answer: (found: UpdateCheck) => act(() => answer(found)), asked };
};

const render = () => act(() => root.render(<AboutSection />));

afterEach(() => {
  act(() => root.render(null));
  setPlatform(null);
  vi.unstubAllGlobals();
});

describe("About's update", () => {
  // The server's version is not what these are about: its health answers nothing.
  const quietHealth = () =>
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));

  it("asks GitHub as it opens, and says up to date only once that check finds nothing", async () => {
    quietHealth();
    const { answer, asked } = shell(null);
    await render();
    expect(asked).toEqual(["check"]);
    expect(host.textContent).toContain("Checking for updates…");
    expect(host.textContent).not.toContain("Up to date");
    await answer("current");
    expect(host.querySelector("[role=status]")?.textContent).toBe("Up to date");
  });

  it("says it could not check when GitHub could not be asked, never up to date", async () => {
    quietHealth();
    const { answer } = shell(null);
    await render();
    await answer("failed");
    expect(host.textContent).toContain("Couldn’t check for updates");
    expect(host.textContent).not.toContain("Up to date");
  });

  it("says the update is downloading while a release it found is not ready yet", async () => {
    quietHealth();
    const { answer } = shell(null);
    await render();
    await answer("newer");
    expect(host.textContent).toContain("Downloading the update…");
    expect(host.textContent).not.toContain("Up to date");
  });

  it("says nothing of its version where the shell cannot check, never up to date", async () => {
    quietHealth();
    setPlatform({
      serverUrl: "ws://localhost:4000/ws",
      update: { current: () => null, subscribe: () => () => undefined },
    } as unknown as Platform);
    await render();
    expect(host.textContent).not.toContain("Up to date");
    expect(host.textContent).not.toContain("Checking");
  });

  it("offers the update the hourly check found while it asks again", async () => {
    quietHealth();
    shell(UPDATE);
    await render();
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Restart to update")
      )
    ).toBe(true);
    // Said in the status region too, so a screen reader hears it become ready.
    expect(host.querySelector("[role=status]")?.textContent).toBe(
      "Restart to update to 0.3.0"
    );
    expect(host.textContent).not.toContain("Checking");
  });
});

describe("About's Node.js", () => {
  const quietHealth = () =>
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));

  /** The desktop shell, whose Node.js answers each ask with the next of `answers`. */
  const nodeShell = (answers: NodeStatus[]) => {
    const asked: string[] = [];
    setPlatform({
      node: {
        status: () => {
          asked.push("node");
          return Promise.resolve(answers.shift() ?? { _tag: "Missing" });
        },
      },
      serverUrl: "ws://localhost:4000/ws",
    } as unknown as Platform);
    return asked;
  };

  const row = () => host.querySelector("[data-setting=node]");
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label);

  it("shows the version and where it is when Node.js is ready", async () => {
    quietHealth();
    nodeShell([
      { _tag: "Ready", path: "/opt/homebrew/bin/node", version: "v26.13.1" },
    ]);
    await render();
    expect(row()?.textContent).toContain("/opt/homebrew/bin/node");
    expect(row()?.textContent).toContain("v26.13.1");
    expect(button("Check again")).toBeUndefined();
  });

  const failed: NodeStatus = {
    _tag: "Failed",
    path: "/Users/someone/.vite-plus/bin/node",
    reason: "vp: no Node.js version set (exit code 1)",
  };

  it("says why a node that didn't run failed, never that it is too old", async () => {
    quietHealth();
    nodeShell([failed]);
    await render();
    expect(row()?.textContent).toContain("Didn’t run");
    expect(row()?.textContent).toContain(
      "vp: no Node.js version set (exit code 1)"
    );
    expect(row()?.textContent).not.toContain("too old");
  });

  it("asks the shell again on Check again, and shows what it finds then", async () => {
    quietHealth();
    const asked = nodeShell([
      failed,
      { _tag: "Ready", path: failed.path, version: "v26.13.1" },
    ]);
    await render();
    await act(async () => {
      button("Check again")?.click();
      await Promise.resolve();
    });
    expect(asked).toEqual(["node", "node"]);
    // In the status region, so a screen reader hears what the check found.
    expect(row()?.querySelector("[role=status]")?.textContent).toBe("v26.13.1");
  });

  it("says how to install a Node.js that is missing or too old", async () => {
    quietHealth();
    nodeShell([{ _tag: "TooOld", path: "/usr/bin/node", version: "v18.19.0" }]);
    await render();
    expect(row()?.textContent).toContain("v18.19.0, too old");
    expect(row()?.querySelector("a")?.getAttribute("href")).toContain(
      "nodejs.org"
    );
  });

  it("is not there where the shell cannot tell", async () => {
    quietHealth();
    setPlatform({ serverUrl: "ws://localhost:4000/ws" } as Platform);
    await render();
    expect(row()).toBeNull();
  });
});

describe("About in Ultrapaint Dev", () => {
  it("names Ultrapaint Dev and the branch and commit it runs, not the server's version", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ version: "0.4.0" }))
    );
    setPlatform({
      dev: {
        current: () => ({ branch: "main", commit: "3f2a1c9" }),
        subscribe: () => () => undefined,
      },
      serverUrl: "ws://localhost:4000/ws",
    } as unknown as Platform);
    await render();
    const version = host.querySelector("[data-setting=version]");
    expect(version?.querySelector("h3")?.textContent).toBe("Ultrapaint Dev");
    expect(version?.textContent).toContain("main · 3f2a1c9");
    expect(version?.textContent).not.toContain("0.4.0");
  });
});
