// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { DialogHost } from "./dialogs.tsx";
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

/**
 * A shell with three projects, `shop` open, which records what it is asked. It keeps a session
 * for `blog` that holds what its folder does not.
 */
const shell = () => {
  const asked: string[] = [];
  setPlatform({
    projects: {
      current: () => Promise.resolve("shop"),
      list: () =>
        Promise.resolve([
          { detail: "/work/blog", id: "blog", name: "Blog", unsaved: true },
          { detail: "/work/shop", id: "shop", name: "Shop", unsaved: false },
          {
            detail: "devbox:~/site",
            id: "site",
            name: "Site",
            unsaved: false,
          },
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

/** The switcher's own button, which opens its menu. */
const openMenu = () =>
  press(named([...host.querySelectorAll("button")], "Shop"));

const draw = async () => {
  act(() =>
    root.render(
      <>
        <ProjectSwitcher />
        <DialogHost />
      </>
    )
  );
  await settled();
  openMenu();
};

/** The projects offered under "Remove from list", its menu opened. */
const removable = () => {
  press(named(items("menuitem"), "Remove from list"));
  return items("menuitem").filter((i) =>
    i.closest("[data-slot=dropdown-menu-sub-content]")
  );
};

/** The question on screen, and its button of that name. */
const question = () => document.body.querySelector("[role=alertdialog]");
const answer = (name: string) =>
  [...(question()?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === name
  );

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
    const offered = removable();
    expect(offered.map((i) => i.textContent)).toEqual([
      "Blog/work/blog",
      "Sitedevbox:~/site",
    ]);
    press(named(offered, "Site"));
    await settled();
    expect(question()).toBeNull();
    expect(asked).toEqual(["remove site"]);
    // Open again, the menu lists what is left.
    openMenu();
    expect(items("menuitemradio").map((i) => i.textContent)).toEqual([
      "Blog/work/blog",
      "Shop/work/shop",
    ]);
  });

  it("asks before it removes a project whose designs are not saved to its folder", async () => {
    const asked = shell();
    await draw();
    press(named(removable(), "Blog"));
    await settled();
    expect(question()?.textContent).toContain("Remove Blog from the list?");
    press(answer("Cancel"));
    await settled();
    expect(asked).toEqual([]);

    openMenu();
    press(named(removable(), "Blog"));
    await settled();
    press(answer("Remove"));
    await settled();
    expect(asked).toEqual(["remove blog"]);
    openMenu();
    expect(items("menuitemradio").map((i) => i.textContent)).toEqual([
      "Shop/work/shop",
      "Sitedevbox:~/site",
    ]);
  });
});
