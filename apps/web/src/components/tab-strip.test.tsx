// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ShellTab } from "@ultrapaint/contracts/shell-bridge";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Platform,
  type PlatformProject,
  setPlatform,
} from "../platform.ts";
import { closeRemoteProject } from "./remote-project-dialog.tsx";
import { TabStripPage } from "./tab-strip.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root | null = null;

const SHOP: ShellTab = {
  icon: { color: "blue", kind: "icon", name: "boxes" },
  id: "shop",
  name: "shop-admin",
  shown: true,
  state: "idle",
};
const DOCS: ShellTab = {
  id: "docs",
  name: "docs-site",
  shown: false,
  state: "working",
};

const LISTED: PlatformProject[] = [
  { detail: "/work/stuck", id: "stuck", name: "stuck", unsaved: false },
  { detail: "~/Code/bike-shop", id: "bike", name: "bike-shop", unsaved: false },
  { detail: "/work/docs", id: "docs", name: "docs-site", unsaved: false },
  { detail: "/work/shop", id: "shop", name: "shop-admin", unsaved: false },
];

/**
 * The strip on a shell with `tabs` open, which records what is asked of it: a page of its own for
 * each test, drawn into a root it unmounts after. `tell` changes the tabs as the shell would.
 */
const draw = async (
  open: readonly ShellTab[] = [SHOP, DOCS],
  { dev = false }: { readonly dev?: boolean } = {}
) => {
  const asked: string[] = [];
  let current = open;
  const listeners = new Set<(value: readonly ShellTab[]) => void>();
  const call =
    (name: string) =>
    (...args: unknown[]) => {
      asked.push([name, ...args.map(String)].join(" "));
      return Promise.resolve();
    };
  setPlatform({
    projects: {
      add: call("add"),
      close: call("close"),
      coverWindow: call("cover"),
      list: () => Promise.resolve(LISTED),
      open: call("open"),
      remove: (id: string) =>
        id === "stuck"
          ? Promise.reject(
              new Error(
                "stuck is open. Close its tab, then remove it from the list."
              )
            )
          : call("remove")(id),
      show: call("show"),
      sshHosts: () => Promise.resolve([]),
    },
    ...(dev
      ? {
          dev: {
            current: () => ({ branch: "main", commit: "3f2a1c9" }),
            subscribe: () => () => undefined,
          },
        }
      : {}),
    serverUrl: "",
    tabs: {
      current: () => current,
      subscribe: (listener: (value: readonly ShellTab[]) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as Platform);
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  mounted = root;
  await act(async () => {
    root.render(<TabStripPage />);
    await Promise.resolve();
  });
  return {
    asked,
    press: (element: Element | null | undefined) =>
      act(() => (element as HTMLElement | null | undefined)?.click()),
    /** Lets what a click set off (the shell's answer) land. */
    settled: () => act(() => Promise.resolve()),
    tell: (next: readonly ShellTab[]) =>
      act(() => {
        current = next;
        for (const listener of listeners) {
          listener(next);
        }
      }),
  };
};

const tabs = () => [...document.body.querySelectorAll("[role=tab]")];
const tabNamed = (name: string) =>
  tabs().find(
    (t) =>
      t.getAttribute("title") === name || t.getAttribute("aria-label") === name
  );
const byLabel = (label: string) =>
  document.body.querySelector(`[aria-label="${label}"]`);
const items = () =>
  [...document.body.querySelectorAll("[role=menuitem]")].map((row) =>
    row.textContent?.trim()
  );
const item = (text: string) =>
  [...document.body.querySelectorAll("[role=menuitem]")].find((i) =>
    i.textContent?.includes(text)
  );

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  // A dialog left open would cover the window from the next test's first draw.
  closeRemoteProject();
  setPlatform(null);
  document.body.innerHTML = "";
});

describe("the tab strip", () => {
  it("shows Home, then a tab per open project in order, the spinner where an agent works", async () => {
    await draw();
    expect(
      tabs().map((t) => t.getAttribute("title") ?? t.getAttribute("aria-label"))
    ).toEqual(["Home", "shop-admin", "docs-site"]);
    expect(tabNamed("shop-admin")?.getAttribute("aria-selected")).toBe("true");
    expect(tabNamed("Home")?.getAttribute("aria-selected")).toBe("false");
    expect(
      tabNamed("docs-site")?.querySelector('[aria-label="An agent is working"]')
    ).not.toBeNull();
    expect(
      tabNamed("shop-admin")?.querySelector(
        '[aria-label="An agent is working"]'
      )
    ).toBeNull();
  });

  it("shows the dot where an agent waits on the person, in the spinner's place", async () => {
    const { tell } = await draw();
    await tell([SHOP, { ...DOCS, state: "waiting" }]);
    const docs = tabNamed("docs-site");
    expect(
      docs?.querySelector('[aria-label="An agent waits on you"]')
    ).not.toBeNull();
    expect(
      docs?.querySelector('[aria-label="An agent is working"]')
    ).toBeNull();
  });

  it("follows the tabs as the shell tells them: Home shown, a tab gone", async () => {
    const { tell } = await draw();
    await tell([{ ...DOCS, state: "idle" }]);
    expect(tabs().length).toBe(2);
    expect(tabNamed("Home")?.getAttribute("aria-selected")).toBe("true");
    expect(
      document.body.querySelector('[aria-label="An agent is working"]')
    ).toBeNull();
  });

  it("shows a tab when clicked, Home too, and closes one with its ×, never showing it", async () => {
    const { asked, press } = await draw();
    press(tabNamed("docs-site"));
    press(tabNamed("Home"));
    press(byLabel("Close docs-site"));
    press(byLabel("Close shop-admin"));
    expect(asked.filter((a) => !a.startsWith("cover"))).toEqual([
      "show docs",
      "show null",
      "close docs",
      "close shop",
    ]);
  });

  it("opens a menu from the +, covering the window while it is open, and opens nothing by itself", async () => {
    const { asked, press, settled } = await draw();
    expect(asked).toEqual(["cover false"]);
    press(byLabel("Open a project"));
    await settled();
    expect(asked).toEqual(["cover false", "cover true"]);
    // Recent lists only the projects not open.
    expect(items()).toEqual([
      // Its initials, its name and where it is.
      "Sstuck/work/stuck",
      "BSbike-shop~/Code/bike-shop",
      "Open folder…",
      "Open over SSH…",
      "New project…",
    ]);
    press(item("bike-shop"));
    await settled();
    expect(asked).toEqual([
      "cover false",
      "cover true",
      "open bike",
      "cover false",
    ]);
  });

  it("opens a folder, Home's start page for a new project, or the SSH dialog from the +", async () => {
    const { asked, press, settled } = await draw();
    press(byLabel("Open a project"));
    await settled();
    press(item("Open folder…"));
    press(byLabel("Open a project"));
    await settled();
    press(item("New project…"));
    expect(asked.filter((a) => !a.startsWith("cover"))).toEqual([
      "add",
      "show null",
    ]);
    press(byLabel("Open a project"));
    await settled();
    press(item("Open over SSH…"));
    await settled();
    expect(document.body.querySelector("[role=dialog]")?.textContent).toContain(
      "Open over SSH"
    );
    // The dialog draws over the page: the strip still covers the window.
    expect(asked.at(-1)).toBe("cover true");
  });

  it("says why a recent project stayed on the list", async () => {
    const { press, settled } = await draw();
    press(byLabel("Open a project"));
    await settled();
    press(byLabel("Remove stuck from the list"));
    await settled();
    expect(document.body.querySelector("[role=alert]")?.textContent).toBe(
      "stuck is open. Close its tab, then remove it from the list."
    );
    expect(items()[0]).toContain("stuck");
  });

  it("takes a recent project off the list with its ×", async () => {
    const { asked, press, settled } = await draw();
    press(byLabel("Open a project"));
    await settled();
    press(byLabel("Remove bike-shop from the list"));
    await settled();
    expect(asked).toContain("remove bike");
    expect(items()).toEqual([
      "Sstuck/work/stuck",
      "Open folder…",
      "Open over SSH…",
      "New project…",
    ]);
  });
});

describe("Ultrapaint Dev's tab strip", () => {
  /** Ultrapaint Dev's blueprint (ADR 0113): its paper, and its drawing, for the eye only. */
  const paper = () => document.body.querySelector("[data-look=blueprint]");
  const drawing = () =>
    document.body.querySelector("[data-look=blueprint-drawing]");

  it("lays its blueprint under the whole strip from the window's left edge, hidden from a screen reader", async () => {
    await draw([SHOP, DOCS], { dev: true });
    const strip = byLabel("Open projects");
    // The strip's first layer, under Home and the tabs.
    expect(strip?.firstElementChild).toBe(paper());
    expect(paper()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws its lines in the room past the +, never behind a tab", async () => {
    await draw([SHOP, DOCS], { dev: true });
    expect(drawing()?.getAttribute("aria-hidden")).toBe("true");
    expect(
      drawing()?.previousElementSibling?.contains(byLabel("Open a project"))
    ).toBe(true);
  });

  it("draws none in the release", async () => {
    await draw([SHOP, DOCS]);
    expect(paper()).toBeNull();
    expect(drawing()).toBeNull();
  });
});
