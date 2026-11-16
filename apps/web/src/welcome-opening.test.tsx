// @vitest-environment happy-dom
import "./testing/fake-browser.ts";
import {
  type Opening,
  openingSteps,
  reachStep,
} from "@ultrapaint/contracts/opening";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "./platform.ts";
import { WelcomePage } from "./welcome.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The shell's opening, as the bridge holds it, and who listens to it. */
let opening: Opening | null = reachStep(
  {
    log: [],
    name: "bike-shop",
    remote: false,
    since: Date.now(),
    steps: openingSteps("local"),
    where: "~/Code/bike-shop",
  },
  "server",
  Date.now()
);
const listeners = new Set<(value: Opening | null) => void>();
const calls: string[] = [];

setPlatform({
  opening: {
    current: () => opening,
    subscribe: (listener: (value: Opening | null) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
  projects: {
    current: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    retryOpening: () => {
      calls.push("retry");
      return Promise.resolve();
    },
    stopOpening: () => {
      calls.push("stop");
      // The shell lets go of the opening: the page shows itself again.
      opening = null;
      for (const listener of listeners) {
        listener(null);
      }
      return Promise.resolve();
    },
  },
  serverUrl: "",
} as unknown as Platform);

document.body.innerHTML = '<div id="root"></div>';
const root = createRoot(document.getElementById("root") as HTMLElement);
await act(async () => {
  root.render(<WelcomePage />);
  await Promise.resolve();
});

afterAll(() => {
  act(() => root.unmount());
  setPlatform(null);
});

const button = (name: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === name
  );

describe("the start page while a project opens", () => {
  it("is the splash, whose Cancel gives the page back", async () => {
    expect(document.querySelector("h1")?.textContent).toBe("Opening bike-shop");
    expect(document.body.textContent).not.toContain("Start a new project");
    await act(async () => {
      button("Cancel")?.click();
      await Promise.resolve();
    });
    expect(calls).toEqual(["stop"]);
    expect(document.body.textContent).toContain("Start a new project");
  });
});
