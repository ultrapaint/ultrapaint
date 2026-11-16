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

/** The opening the shell begins once the page is up. */
const bikeShop: Opening = reachStep(
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
/** The shell's opening, as the bridge holds it, and who listens to it. */
let opening: Opening | null = null;
const tell = (next: Opening | null) => {
  opening = next;
  for (const listener of listeners) {
    listener(next);
  }
};
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
      tell(null);
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

const splash = () => document.querySelector("[aria-busy]");

/** Types into the prompt as a person would, through React's own setter. */
const typePrompt = (value: string) =>
  act(() => {
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("the start page while a project opens", () => {
  it("draws the splash over itself, whose Cancel gives the page back as it was", async () => {
    await typePrompt("A habit tracker for students");
    act(() => tell(bikeShop));
    expect(splash()?.querySelector("h1")?.textContent).toBe(
      "Opening bike-shop"
    );
    // The page under it takes no focus while it is up.
    expect(
      document.querySelector("textarea")?.closest("[inert]")
    ).not.toBeNull();
    await act(async () => {
      button("Cancel")?.click();
      await Promise.resolve();
    });
    expect(calls).toEqual(["stop"]);
    expect(splash()).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    // What was being written is still there.
    expect(document.querySelector("textarea")?.value).toBe(
      "A habit tracker for students"
    );
  });
});
