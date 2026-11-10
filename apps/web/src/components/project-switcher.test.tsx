// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { ProjectSwitcher } from "./project-switcher.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

/** A shell with three projects, `shop` open, which records what it is asked. */
const shell = () => {
  const asked: string[] = [];
  setPlatform({
    projects: {
      current: () => Promise.resolve("shop"),
      list: () =>
        Promise.resolve([
          { detail: "/work/blog", id: "blog", name: "Blog" },
          { detail: "/work/shop", id: "shop", name: "Shop" },
          { detail: "devbox:~/site", id: "site", name: "Site" },
        ]),
      open: (id: string) => {
        asked.push(`open ${id}`);
        return Promise.resolve();
      },
      remove: (id: string) => {
        asked.push(`remove ${id}`);
        return Promise.resolve();
      },
    },
    serverUrl: "",
  } as unknown as Platform);
  return asked;
};

/** Lets what a click set off (the shell's answer, the menu's news of it) land. */
const settled = () => act(() => Promise.resolve());

const press = (element: Element | undefined) =>
  act(() => (element as HTMLElement | undefined)?.click());

const items = (role: string) => [
  ...document.body.querySelectorAll(`[role=${role}]`),
];

const named = (elements: readonly Element[], name: string) =>
  elements.find((e) => e.textContent?.includes(name));

const draw = async () => {
  act(() => root.render(<ProjectSwitcher />));
  await settled();
  press(named([...host.querySelectorAll("button")], "Shop"));
};

afterEach(() => {
  act(() => root.render(null));
  setPlatform(null);
});

describe("the project switcher", () => {
  it("opens the project chosen in its menu", async () => {
    const asked = shell();
    await draw();
    expect(items("menuitemradio").map((i) => i.textContent)).toEqual([
      "Blog/work/blog",
      "Shop/work/shop",
      "Sitedevbox:~/site",
    ]);
    press(named(items("menuitemradio"), "Blog"));
    expect(asked).toEqual(["open blog"]);
  });

  it("removes another project from the list, and never offers the open one", async () => {
    const asked = shell();
    await draw();
    press(named(items("menuitem"), "Remove from list"));
    const offered = items("menuitem").filter((i) =>
      i.closest("[data-slot=dropdown-menu-sub-content]")
    );
    expect(offered.map((i) => i.textContent)).toEqual([
      "Blog/work/blog",
      "Sitedevbox:~/site",
    ]);
    press(named(offered, "Site"));
    await settled();
    expect(asked).toEqual(["remove site"]);
    // Open again, the menu lists what is left.
    press(named([...host.querySelectorAll("button")], "Shop"));
    expect(items("menuitemradio").map((i) => i.textContent)).toEqual([
      "Blog/work/blog",
      "Shop/work/shop",
    ]);
  });
});
