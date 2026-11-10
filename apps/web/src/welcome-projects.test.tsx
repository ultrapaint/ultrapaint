// @vitest-environment happy-dom
import "./testing/fake-browser.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "./platform.ts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The page on a shell with two projects, `shop` open behind it, which records removals. The
 * page is the window's entry and draws itself into `#root` as its module is read: read anew for
 * each test, with the modules it stands on, so that each has a page of its own.
 */
const draw = async (
  shell: {
    /** Whether the shell keeps a session for `blog` that holds what its folder does not. */
    readonly unsaved?: boolean;
    /** Why the shell removes nothing. */
    readonly refuses?: string;
  } = {}
) => {
  vi.resetModules();
  const { act } = await import("react");
  const { setPlatform } = await import("./platform.ts");
  const removed: string[] = [];
  setPlatform({
    projects: {
      current: () => Promise.resolve("shop"),
      list: () =>
        Promise.resolve([
          {
            detail: "/work/blog",
            id: "blog",
            name: "Blog",
            unsaved: shell.unsaved ?? false,
          },
          { detail: "/work/shop", id: "shop", name: "Shop", unsaved: false },
        ]),
      remove: (id: string) => {
        if (shell.refuses !== undefined) {
          return Promise.reject(new Error(shell.refuses));
        }
        removed.push(id);
        return Promise.resolve();
      },
    },
    serverUrl: "",
  } as unknown as Platform);
  document.body.innerHTML = '<div id="root"></div>';
  await act(() => import("./welcome.tsx"));
  return {
    press: (element: Element | null | undefined) =>
      act(() => (element as HTMLElement | null | undefined)?.click()),
    removed,
    /** Lets what a click set off (the shell's answer, the page's news of it) land. */
    settled: () => act(() => Promise.resolve()),
  };
};

const rows = () =>
  [...document.body.querySelectorAll("li")].map(
    (row) => row.querySelector("button")?.textContent
  );

const actionsFor = (name: string) =>
  document.body.querySelector(`[aria-label="Actions for ${name}"]`);

/** "Remove from list" in the menus open, and whether each can be chosen. */
const removeItems = () =>
  [...document.body.querySelectorAll("[role=menuitem]")].filter((item) =>
    item.textContent?.includes("Remove from list")
  );
const offered = (item: Element) => !item.hasAttribute("data-disabled");

/** The question on screen: its title, and its button of that name. */
const question = () => document.body.querySelector("[role=alertdialog]");
const answer = (name: string) =>
  [...(question()?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === name
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the start screen's projects", () => {
  // Reading the editor's modules again takes a second or two, and more on a busy machine.
  it("takes a project off the list from its row's menu, but not the one open behind the page", async () => {
    const { press, removed, settled } = await draw();
    await settled();
    expect(rows()).toEqual(["Blog/work/blog", "Shop/work/shop"]);

    press(actionsFor("Shop"));
    expect(removeItems().map(offered)).toEqual([false]);
    press(removeItems()[0]);
    await settled();
    expect(removed).toEqual([]);

    press(actionsFor("Blog"));
    press(removeItems().find(offered));
    await settled();
    expect(removed).toEqual(["blog"]);
    expect(rows()).toEqual(["Shop/work/shop"]);
  }, 20_000);

  it("asks before it removes a project whose designs are not saved to its folder", async () => {
    const { press, removed, settled } = await draw({ unsaved: true });
    await settled();

    press(actionsFor("Blog"));
    press(removeItems().find(offered));
    await settled();
    expect(question()?.textContent).toContain("Remove Blog from the list?");
    expect(question()?.textContent).toContain(
      "The designs not saved to its folder are deleted"
    );
    press(answer("Cancel"));
    await settled();
    expect(removed).toEqual([]);
    expect(rows()).toEqual(["Blog/work/blog", "Shop/work/shop"]);

    press(actionsFor("Blog"));
    press(removeItems().find(offered));
    await settled();
    press(answer("Remove"));
    await settled();
    expect(removed).toEqual(["blog"]);
    expect(rows()).toEqual(["Shop/work/shop"]);
  }, 20_000);

  it("says a project could not be removed, and why", async () => {
    const { press, settled } = await draw({
      refuses: "The project list could not be written.",
    });
    await settled();

    press(actionsFor("Blog"));
    press(removeItems().find(offered));
    await settled();
    expect(document.body.querySelector("[role=alert]")?.textContent).toBe(
      "Couldn’t remove the projectThe project list could not be written."
    );
    expect(rows()).toEqual(["Blog/work/blog", "Shop/work/shop"]);
  }, 20_000);
});
