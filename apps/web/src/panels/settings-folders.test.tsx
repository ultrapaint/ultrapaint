// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FolderMove,
  type FolderSetup,
  type Platform,
  setPlatform,
} from "../platform.ts";
import { useProject } from "../state/project.ts";
import { FoldersGroup } from "./settings-folders.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

/** The desktop app's folders, as its shell answers for them; what was opened is kept. */
const desktop = (moveUser: () => Promise<FolderMove>) => {
  const opened: string[] = [];
  const folders: FolderSetup = {
    current: () =>
      Promise.resolve({
        newProjects: "/home/ada/Ultrapaint",
        user: "/home/ada/.ultrapaint",
      }),
    moveUser,
    open: (folder) => {
      opened.push(folder);
      return Promise.resolve();
    },
    setNewProjects: () => Promise.resolve("/home/ada/Work"),
  };
  setPlatform({ folders, serverUrl: "ws://127.0.0.1:1/ws" } as Platform);
  return opened;
};

const render = async () => {
  act(() => mounted.render(<FoldersGroup />));
  // The shell's answer lands, and the rows draw what it says.
  await act(() => Promise.resolve());
};

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

/** Each row's title. */
const titles = () =>
  [...container.querySelectorAll("label")].map((l) => l.textContent);

beforeEach(() => {
  useProject.setState({
    info: {
      configured: true,
      folders: {
        project: "/work/shop/.ultrapaint",
        user: "/home/ada/.ultrapaint",
      },
      storage: { mode: "file" },
    },
  });
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  setPlatform(null);
});

describe("Settings › About › Folders (ADR 0091)", () => {
  it("in the desktop app, opens and moves your folder, changes where new projects go, and opens the project’s data", async () => {
    const opened = desktop(() => Promise.resolve({}));
    await render();
    expect(titles()).toEqual([
      "Your folder",
      "New projects",
      "This project’s data",
    ]);
    expect(container.textContent).toContain("/home/ada/.ultrapaint");
    expect(container.textContent).toContain("/home/ada/Ultrapaint");
    expect(container.textContent).toContain("/work/shop/.ultrapaint");
    expect(container.textContent).not.toContain("ULTRAPAINT_USER_DIR");
    const opens = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === "Open"
    );
    expect(opens).toHaveLength(2);
    act(() => {
      for (const open of opens) {
        open.click();
      }
    });
    expect(opened).toEqual(["/home/ada/.ultrapaint", "/work/shop/.ultrapaint"]);
    expect(button("Move…")).toBeDefined();
    await act(async () => {
      button("Change…")?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("/home/ada/Work");
  });

  it("shows the move under way on its button, and why a move was refused under its row", async () => {
    let answer: (outcome: FolderMove) => void = () => undefined;
    desktop(
      () =>
        new Promise((done) => {
          answer = done;
        })
    );
    await render();
    act(() => button("Move…")?.click());
    const moving = button("Moving…");
    expect(moving?.disabled).toBe(true);
    expect(moving?.querySelector("[data-slot=spinner]")).not.toBeNull();
    await act(async () => {
      answer({
        problem:
          "/home/ada/Sync already has a .ultrapaint folder. Choose another folder, or move that one away first.",
      });
      await Promise.resolve();
    });
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "/home/ada/Sync already has a .ultrapaint folder. Choose another folder, or move that one away first."
    );
    expect(button("Move…")?.disabled).toBe(false);
  });

  it("in a browser, shows your folder to copy and says how to move it, with no desktop rows or buttons", async () => {
    useProject.setState({
      info: {
        configured: true,
        folders: { user: "/home/ada/.ultrapaint" },
        storage: { mode: "ephemeral" },
      },
    });
    await render();
    expect(titles()).toEqual(["Your folder"]);
    expect(container.textContent).toContain(
      "To move it, start Ultrapaint with ULTRAPAINT_USER_DIR set."
    );
    expect(container.querySelector("code")?.textContent).toBe(
      "ULTRAPAINT_USER_DIR"
    );
    expect(button("Move…")).toBeUndefined();
    expect(button("Open")).toBeUndefined();
    expect(
      container.querySelector("button[aria-label='Copy the path']")
    ).not.toBeNull();
  });
});
