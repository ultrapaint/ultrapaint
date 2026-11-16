// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import {
  failOpening,
  noteLine,
  type Opening,
  openingSteps,
  reachStep,
} from "@ultrapaint/contracts/opening";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpeningSplash, type OpeningSplashProps } from "./opening-splash.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const show = (props: OpeningSplashProps) =>
  act(() => {
    root = createRoot(document.getElementById("root") as HTMLElement);
    root.render(<OpeningSplash {...props} />);
  });

/** A local project two seconds into its open, the server started in 0.5 s. */
const local = (changes: Partial<Opening> = {}): Opening => {
  let opening: Opening = {
    log: [],
    name: "bike-shop",
    remote: false,
    since: NOW - 2000,
    steps: openingSteps("local"),
    where: "~/Code/bike-shop",
    ...changes,
  };
  opening = reachStep(opening, "server", NOW - 2000);
  return reachStep(opening, "project", NOW - 1500);
};

const text = () => document.body.textContent ?? "";
const button = (name: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name
  );
const steps = () =>
  [...document.querySelectorAll("ol li")].map((li) => li.textContent);

describe("the splash a project opens on", () => {
  it("names the project and where it is, and every step with its time", () => {
    show({ opening: local() });
    expect(document.querySelector("h1")?.textContent).toBe("Opening bike-shop");
    expect(text()).toContain("~/Code/bike-shop");
    expect(steps()).toEqual([
      "Starting the server0.5 s",
      "Reading the project1.5 s",
      "Drawing the canvas",
    ]);
  });

  it("estimates the time left from the project's last opening", () => {
    show({ opening: local({ estimate: 4000 }) });
    expect(text()).toContain("About 2 s left");
  });

  it("says when it takes longer than last time", () => {
    show({ opening: local({ estimate: 1000 }) });
    expect(text()).toContain("Longer than last time (1 s)");
  });

  it("shows no bar on a first open, which has no estimate", () => {
    show({ opening: local() });
    expect(text()).not.toContain("left");
    expect(document.querySelector("[aria-hidden] svg path[transform]")).toBe(
      null
    );
  });

  it("shows the last line a slow step printed", () => {
    show({
      opening: noteLine(
        reachStep(local(), "project", NOW - 1500),
        "pnpm install · 214 packages"
      ),
    });
    expect(text()).toContain("pnpm install · 214 packages");
  });

  it("says why an open failed under its step, with Cancel and Try again", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    show({
      onCancel,
      onRetry,
      opening: failOpening(
        local(),
        "naf-mini did not accept a key. Load your key with ssh-add, then try again.",
        NOW
      ),
    });
    expect(document.querySelector("h1")?.textContent).toBe(
      "bike-shop didn’t open"
    );
    expect(text()).toContain("naf-mini did not accept a key.");
    expect(text()).toContain("Load your key with ssh-add, then try again.");
    act(() => button("Try again")?.click());
    expect(onRetry).toHaveBeenCalledOnce();
    act(() => button("Cancel")?.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("is cancelled with Escape", () => {
    const onCancel = vi.fn();
    show({ onCancel, opening: local() });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers a remote project's log, to read and to copy", () => {
    let opening: Opening = {
      log: [],
      name: "bike-shop",
      remote: true,
      since: NOW - 2000,
      steps: openingSteps("ssh", "naf-mini"),
      where: "naf-mini:~/Code/bike-shop",
    };
    opening = reachStep(opening, "connect", NOW - 2000);
    opening = noteLine(opening, "Authenticated to naf-mini");
    const log = () => document.querySelector("pre")?.textContent;
    show({ onCancel: () => undefined, opening });
    expect(log()).toBeUndefined();
    act(() => button("Show log")?.click());
    expect(log()).toBe("Authenticated to naf-mini");
    expect(button("Copy log")).toBeDefined();
    act(() => button("Hide log")?.click());
    expect(log()).toBeUndefined();
  });

  it("has no buttons where there is nothing to do: a local open in a browser", () => {
    show({ opening: local() });
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});
