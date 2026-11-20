// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  ProjectNotice,
  ShellTab,
} from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { type Platform, setPlatform } from "../platform.ts";
import { anotherTabShown, followProjectNotices } from "./project-notices.ts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tab = (id: string, shown: boolean): ShellTab => ({
  id,
  name: id,
  shown,
  state: "idle",
});

const ASKS: ProjectNotice = {
  id: "1",
  news: "asks",
  project: "docs",
  title: "docs-site: an agent asks you something",
};

let mounted: Root | null = null;
let stop: (() => void) | null = null;

/**
 * The page of project `own` in the desktop app, its toasts drawn: what it asks of the shell is
 * recorded, and `tell` gives it the app's notice as the app would.
 */
const page = async (own: string) => {
  // fake clock: the toaster draws a toast on the timer after it is asked for one.
  vi.useFakeTimers();
  const asked: string[] = [];
  let current: ProjectNotice | null = null;
  const listeners = new Set<(value: ProjectNotice | null) => void>();
  setPlatform({
    projectId: { current: () => own, subscribe: () => () => undefined },
    projectNotice: {
      current: () => current,
      subscribe: (listener: (value: ProjectNotice | null) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    projects: {
      show: (id: string) => {
        asked.push(`show ${id}`);
        return Promise.resolve();
      },
    },
    serverUrl: "",
  } as unknown as Platform);
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  mounted = root;
  await act(async () => {
    root.render(<Toaster />);
    await Promise.resolve();
  });
  stop = followProjectNotices();
  return {
    asked,
    tell: (next: ProjectNotice | null) =>
      act(async () => {
        current = next;
        for (const listener of listeners) {
          listener(next);
        }
        await vi.advanceTimersByTimeAsync(0);
      }),
  };
};

const goToIt = () =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === "Go to it"
  );

afterEach(() => {
  stop?.();
  stop = null;
  // The toaster keeps its toasts for the next one drawn.
  toast.dismiss();
  vi.useRealTimers();
  act(() => mounted?.unmount());
  mounted = null;
  setPlatform(null);
  document.body.innerHTML = "";
});

describe("the notice of another project's agent (ADR 0107)", () => {
  it("says which project's agent asks, and Go to it shows that project's tab", async () => {
    const { asked, tell } = await page("shop");
    await tell(ASKS);
    expect(document.body.textContent).toContain(
      "docs-site: an agent asks you something"
    );
    await act(async () => goToIt()?.click());
    expect(asked).toEqual(["show docs"]);
  });

  it("is not shown on the page of the project it is about", async () => {
    const { tell } = await page("docs");
    await tell({ ...ASKS, id: "2", title: "docs: an agent finished" });
    expect(document.body.textContent).not.toContain("docs: an agent finished");
    expect(goToIt()).toBeUndefined();
  });
});

describe("who tells a page's own agents' news (ADR 0107)", () => {
  const shell = (own: string | null, tabs?: readonly ShellTab[]) =>
    ({
      ...(own === null
        ? {}
        : {
            projectId: { current: () => own, subscribe: () => () => undefined },
          }),
      ...(tabs
        ? { tabs: { current: () => tabs, subscribe: () => () => undefined } }
        : {}),
    }) as unknown as Platform;

  it("the page, while its project's tab is on screen, or in a browser", () => {
    expect(anotherTabShown(shell("a", [tab("a", true), tab("b", false)]))).toBe(
      false
    );
    expect(anotherTabShown(shell(null))).toBe(false);
  });

  it("the app, while another project's tab or Home is on screen", () => {
    expect(anotherTabShown(shell("a", [tab("a", false), tab("b", true)]))).toBe(
      true
    );
    expect(anotherTabShown(shell("a", [tab("a", false)]))).toBe(true);
  });
});
