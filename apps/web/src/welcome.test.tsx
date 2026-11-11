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
const PNG_DATA = /^data:image\/png;base64,/;

/** What the project was to be opened with. */
const opened: unknown[] = [];
setPlatform({
  pickFolder: () => {
    picks += 1;
    return picks === 1
      ? Promise.reject(new Error("The folder picker did not open"))
      : Promise.resolve("/home/me/shop");
  },
  projects: {
    current: () => Promise.resolve(null),
    inspect: () => Promise.resolve({ kind: "project", name: "Shop" }),
    list: () => Promise.resolve([]),
    openFolder: (_folder: string, start: unknown) => {
      opened.push(start);
      return Promise.reject(new Error("Its server did not start"));
    },
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

/** Resolves once `drawn` holds, as the page changes: what a click set off has landed. */
const until = (drawn: () => boolean) =>
  new Promise<void>((resolve) => {
    if (drawn()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (drawn()) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

/** Picks `files` in the system's file picker that the + button opens, until they are shown. */
const pickFiles = async (files: File[]) => {
  const input = document.querySelector(
    "input[type=file][multiple]"
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Read as the chat reads them, a picture as a data URL, then drawn as chips.
  await until(() =>
    files.every(
      (file) =>
        document.body.textContent?.includes(file.name) ||
        document.querySelector(`img[alt="${file.name}"]`)
    )
  );
};

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

  it("sends the pictures and text files attached to the prompt with it", async () => {
    await typePrompt("A bike shop");
    await pickFiles([
      new File([new Uint8Array([137, 80, 78, 71])], "sketch.png", {
        type: "image/png",
      }),
      new File(["Warm and quiet"], "brief.md", { type: "text/markdown" }),
    ]);
    expect(
      document.querySelector('img[alt="sketch.png"]')?.getAttribute("src")
    ).toMatch(PNG_DATA);
    expect(document.body.textContent).toContain("brief.md");

    press(button("New folder in ~/Ultrapaint"));
    press(button("Choose a folder…"));
    await settled();
    press(button("Open Shop"));
    await settled();
    expect(opened.at(-1)).toMatchObject({
      attachments: [
        { kind: "image", name: "sketch.png" },
        { kind: "text", name: "brief.md", text: "Warm and quiet" },
      ],
      prompt: "A bike shop",
    });
  });
});
