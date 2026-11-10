// @vitest-environment happy-dom
import "./testing/fake-browser.ts";
import { act } from "react";
import { afterAll, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "./platform.ts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A shell whose folder picker fails once, and whose project never opens. */
let picks = 0;
setPlatform({
  pickFolder: () => {
    picks += 1;
    return picks === 1
      ? Promise.reject(new Error("The folder picker did not open"))
      : Promise.resolve("/home/me/shop");
  },
  projects: {
    inspect: () => Promise.resolve({ kind: "project", name: "Shop" }),
    list: () => Promise.resolve([]),
    openFolder: () => Promise.reject(new Error("Its server did not start")),
  },
  serverUrl: "",
} as unknown as Platform);

// The page is the window's entry: it draws itself into `#root` as its module is read, here
// rather than in the test, whose time is not the time reading the editor's modules takes.
document.body.innerHTML = '<div id="root"></div>';
await act(() => import("./welcome.tsx"));

/** Lets what a click set off (a picker's answer, the page's news of it) land. */
const settled = () => act(() => Promise.resolve());

const press = (element: Element | null | undefined) =>
  act(() => (element as HTMLElement | null | undefined)?.click());

const button = (name: string) =>
  [...document.body.querySelectorAll("button, [role=menuitem]")].find((b) =>
    b.textContent?.includes(name)
  );

const alerts = () =>
  [...document.body.querySelectorAll("[role=alert]")].map((a) => a.textContent);

afterAll(() => {
  setPlatform(null);
  document.body.innerHTML = "";
});

describe("the start screen", () => {
  it("says on the page why a folder could not be chosen, or a project found there not opened", async () => {
    press(button("New folder in ~/Ultrapaint"));
    press(button("Choose a folder…"));
    await settled();
    expect(alerts().join()).toContain("The folder picker did not open");

    press(button("New folder in ~/Ultrapaint"));
    press(button("Choose a folder…"));
    await settled();
    press(button("Open Shop"));
    await settled();
    expect(alerts().join()).toContain("Its server did not start");
  });
});
