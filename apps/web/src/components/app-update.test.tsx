// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { AppUpdate } from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { UpdateButton } from "./app-update.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

const RELEASES: AppUpdate["releases"] = [
  {
    date: "2026-11-12T10:00:00Z",
    notes: "Pictures on the start screen.",
    version: "0.1.3",
  },
  { date: "2026-11-11T10:00:00Z", notes: "", version: "0.1.2" },
];

/** A shell that holds `update`, tells its listeners when it changes, and records installs. */
const shell = (initial: AppUpdate | null) => {
  let update = initial;
  const listeners = new Set<(value: AppUpdate | null) => void>();
  const installs: string[] = [];
  setPlatform({
    installUpdate: () => {
      installs.push("install");
      return Promise.resolve();
    },
    serverUrl: "",
    update: {
      current: () => update,
      subscribe: (listener: (value: AppUpdate | null) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as Platform);
  const tell = (next: AppUpdate | null) =>
    act(() => {
      update = next;
      for (const listener of listeners) {
        listener(next);
      }
    });
  return { installs, tell };
};

const render = () => act(() => root.render(<UpdateButton />));

const button = (name: string) =>
  [...document.body.querySelectorAll("button, a")].find((b) =>
    b.textContent?.includes(name)
  ) as HTMLElement | undefined;

const press = (element: HTMLElement | undefined) => act(() => element?.click());

afterEach(() => {
  act(() => root.render(null));
  setPlatform(null);
});

describe("the app's update", () => {
  it("shows nothing while there is no update, in a browser too", async () => {
    shell(null);
    await render();
    expect(host.textContent).toBe("");
    setPlatform(null);
    await render();
    expect(host.textContent).toBe("");
  });

  it("appears once it is downloaded, with what each release since brings, and restarts into it", async () => {
    const { installs, tell } = shell(null);
    await render();
    await tell({
      current: "0.1.1",
      install: "restart",
      releases: RELEASES,
      url: "https://github.com/ultrapaint/ultrapaint/releases/tag/v0.1.3",
    });
    await press(button("Restart to update"));
    const popup = document.body.textContent ?? "";
    expect(popup).toContain("Ultrapaint 0.1.3");
    expect(popup).toContain("You have 0.1.1");
    expect(popup).toContain("Pictures on the start screen.");
    // Only the release with notes has a section.
    expect(popup).not.toContain("0.1.2 ·");
    const restart = [...document.body.querySelectorAll("button")].filter(
      (b) => b.textContent === "Restart to update"
    );
    await press(restart.at(-1));
    expect(installs).toEqual(["install"]);
  });

  it("links to the release where this copy cannot replace itself, saying why", async () => {
    shell({
      current: "0.1.1",
      install: "download",
      reason: "Ultrapaint can’t replace itself in /Applications.",
      releases: RELEASES,
      url: "https://github.com/ultrapaint/ultrapaint/releases/tag/v0.1.3",
    });
    await render();
    await press(button("0.1.3 is out"));
    expect(document.body.textContent).toContain(
      "Ultrapaint can’t replace itself in /Applications."
    );
    expect(document.body.querySelector("a[href$='/v0.1.3']")?.textContent).toBe(
      "Download"
    );
  });
});
