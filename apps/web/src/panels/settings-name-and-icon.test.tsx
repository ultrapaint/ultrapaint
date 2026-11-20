// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import { defaultSettings, type Settings } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { SettingsPage } from "./settings.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const initialProject = useProject.getState();
let mounted: Root | null = null;
const container = document.createElement("div");
document.body.append(container);

/** Settings › Name and icon open on a project whose settings are `given`. */
const open = (given: Partial<Settings> = {}) => {
  fakeApi.reset();
  const settings = { ...defaultSettings("/work/shop-admin"), ...given };
  const info: ProjectInfo = {
    configured: true,
    icon: { color: "pink", initial: "S", kind: "initial" },
    name: "shop-admin",
    repoPath: "/work/shop-admin",
    settings,
    storage: {
      configPath: "/work/shop-admin/ultrapaint.config.json",
      mode: "file",
    },
  };
  fakeApi.respond("project.info", () => info);
  fakeApi.respond("pages.list", () => ({ canvases: [], pages: [] }));
  fakeApi.respond("edit.state", () => ({ canRedo: false, canUndo: false }));
  fakeApi.respond("settings.set", () => ({ ok: true, problems: [] }));
  fakeApi.respond("project.images", () => [
    "public/favicon.svg",
    "app/icon.png",
  ]);
  useProject.setState({
    info,
    loaded: true,
    settings,
    settingsOpen: true,
    settingsSection: "nameAndIcon",
  });
  mounted = createRoot(container);
  act(() => mounted?.render(<SettingsPage />));
  return settings;
};

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  useProject.setState(initialProject, true);
});

const sets = () =>
  fakeApi.calls
    .filter((c) => c.method === "settings.set")
    .map((c) => c.input as Settings);

const saved = async () => {
  await act(async () => {
    await fakeApi.requested("settings.set");
  });
  return sets().at(-1);
};

const press = (element: Element | null | undefined) =>
  act(() => (element as HTMLElement | null | undefined)?.click());

/** A button of that name, on the page or in a dialog over it. */
const button = (name: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name
  );

/** An option of a dialog's choices, by its name. */
const option = (name: string) =>
  [...document.body.querySelectorAll("[role=radio]")].find(
    (b) =>
      b.getAttribute("aria-label") === name || b.textContent?.includes(name)
  );

const type = (input: HTMLInputElement | null, value: string) =>
  act(() => {
    if (!input) {
      throw new Error("no field");
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("Settings › Name and icon (ADR 0107)", () => {
  it("leads the project's sections", () => {
    open();
    const sections = [
      ...container.querySelectorAll(
        "nav[aria-label='Settings sections'] button"
      ),
    ].map((b) => b.textContent);
    expect(sections.slice(4, 6)).toEqual(["Name and icon", "Repository"]);
  });

  it("saves the name when its field is left, and offers the folder's name for an empty one", async () => {
    const settings = open();
    const field = container.querySelector<HTMLInputElement>(
      "#settings-project-name"
    );
    expect(field?.placeholder).toBe("shop-admin");
    type(field, "Shop admin");
    act(() =>
      field?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    );
    expect(await saved()).toEqual({ ...settings, name: "Shop admin" });
  });

  it("saves an icon of the set in a colour chosen in Choose icon", async () => {
    const settings = open();
    press(button("Choose icon"));
    press(option("teal"));
    press(option("flame"));
    press(button("Save"));
    expect(await saved()).toEqual({
      ...settings,
      icon: { color: "teal", kind: "icon", name: "flame" },
    });
  });

  it("finds an icon by its name", () => {
    open();
    press(button("Choose icon"));
    type(
      document.body.querySelector<HTMLInputElement>(
        "input[aria-label='Search icons']"
      ),
      "shopping cart"
    );
    const found = [
      ...document.body.querySelectorAll("[aria-label=Icon] [role=radio]"),
    ].map((b) => b.getAttribute("aria-label"));
    expect(found).toContain("shopping-cart");
    expect(found.every((name) => name?.includes("shopping-cart"))).toBe(true);
  });

  it("saves nothing when Choose icon is cancelled", () => {
    open();
    press(button("Choose icon"));
    press(option("flame"));
    press(button("Cancel"));
    expect(sets()).toEqual([]);
  });

  it("saves an image found in the project chosen in Choose file", async () => {
    const settings = open();
    press(button("Choose file"));
    await act(async () => {
      await fakeApi.requested("project.images");
    });
    press(option("app/icon.png"));
    press(button("Save"));
    expect(await saved()).toEqual({
      ...settings,
      icon: { kind: "file", path: "app/icon.png" },
    });
  });

  it("saves any other image of the project typed in Choose file", async () => {
    const settings = open();
    press(button("Choose file"));
    await act(async () => {
      await fakeApi.requested("project.images");
    });
    press(button("Choose another file…"));
    const field = document.body.querySelector<HTMLInputElement>(
      "input[aria-label='Path in the project']"
    );
    type(field, "./docs/brand/mark.svg");
    act(() =>
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      )
    );
    press(button("Save"));
    expect(await saved()).toEqual({
      ...settings,
      icon: { kind: "file", path: "docs/brand/mark.svg" },
    });
  });

  it("goes back to the default icon with the arrow, shown only while one is set", async () => {
    open();
    expect(button("Use the default")).toBeUndefined();
    act(() => mounted?.unmount());
    const settings = open({
      icon: { kind: "file", path: "brand/mark.svg" },
    });
    expect(container.textContent).toContain("brand/mark.svg");
    press(button("Use the default"));
    const { icon: _icon, ...withoutIcon } = settings;
    expect(await saved()).toEqual(withoutIcon);
  });
});
