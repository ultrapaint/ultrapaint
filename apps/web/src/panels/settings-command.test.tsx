// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
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

/** The desktop shell, with no `ultrapaint` command on the PATH; Ultrapaint Dev's with `dev`. */
const shell = (dev: boolean) =>
  setPlatform({
    command: {
      install: () => Promise.reject(new Error("not asked")),
      installed: () => Promise.resolve(null),
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
});
