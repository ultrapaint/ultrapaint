// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { defaultSettings, type Settings } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { problemRow, SettingsPage } from "./settings.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("a refused save's reasons", () => {
  it("go under the row they are about", () => {
    expect(problemRow("Repository path does not exist: /nowhere")).toBe("path");
    expect(problemRow("Designs directory does not exist: docs/x")).toBe(
      "designs"
    );
    expect(problemRow("Application has no package.json: apps/x")).toBe(
      "application"
    );
    expect(problemRow("Component directory does not exist: src/ui")).toBe(
      "components"
    );
  });

  it("go under the row changed when no row holds them", () => {
    expect(problemRow("Settings were set in the meantime.")).toBeNull();
  });
});

describe("the settings save as they change (ADR 0079)", () => {
  const settings = defaultSettings("/repo");
  let mounted: Root;
  let container: HTMLElement;

  const sets = () =>
    fakeApi.calls
      .filter((c) => c.method === "settings.set")
      .map((c) => c.input as Settings);

  const row = (id: string) =>
    container.querySelector(`#${id}`)?.closest(".px-4") ?? null;

  beforeEach(() => {
    fakeApi.reset();
    const info = {
      configured: true,
      settings,
      storage: { configPath: "/repo/ultrapaint.config.json", mode: "file" },
    } as const;
    fakeApi.respond("project.info", () => info);
    fakeApi.respond("pages.list", () => ({ canvases: [], pages: [] }));
    fakeApi.respond("edit.state", () => ({ canRedo: false, canUndo: false }));
    useProject.setState({
      info,
      loaded: true,
      settings,
      settingsOpen: true,
      settingsSection: "repository",
    });
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<SettingsPage />);
    });
  });

  afterEach(() => {
    act(() => mounted.unmount());
  });

  it("a switch saves at once, with no Save button", async () => {
    fakeApi.respond("settings.set", () => ({ ok: true, problems: [] }));
    const toggle = container.querySelector<HTMLElement>("#settings-page-pngs");
    act(() => toggle?.click());
    await act(async () => {
      await fakeApi.requested("settings.set");
    });
    expect(sets()).toEqual([{ ...settings, pagePngs: true }]);
    const buttons = [...container.querySelectorAll("button")].map(
      (b) => b.textContent
    );
    expect(buttons).not.toContain("Save");
  });

  it("has no footer: the close button is the way out, and the file written is a row", () => {
    const buttons = [...container.querySelectorAll("button")].map(
      (b) => b.textContent
    );
    expect(container.querySelector("footer")).toBeNull();
    expect(buttons).not.toContain("Done");
    expect(container.querySelector("button[aria-label=Close]")).not.toBeNull();
    expect(container.textContent).toContain(
      "Configuration fileultrapaint.config.json"
    );
  });

  const typeDesigns = (value: string) => {
    const input =
      container.querySelector<HTMLInputElement>("#settings-designs");
    if (!input) {
      throw new Error("no field");
    }
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("a path still being typed is saved when the close button closes the dialog", async () => {
    fakeApi.respond("settings.set", () => ({ ok: true, problems: [] }));
    typeDesigns("docs/pages");
    expect(sets()).toEqual([]);
    act(() =>
      container.querySelector<HTMLElement>("button[aria-label=Close]")?.click()
    );
    await act(async () => {
      await fakeApi.requested("settings.set");
    });
    expect(useProject.getState().settingsOpen).toBe(false);
    expect(sets()).toEqual([{ ...settings, designsDir: "docs/pages" }]);
  });

  it("a path still being typed is saved when Escape closes the dialog", async () => {
    fakeApi.respond("settings.set", () => ({ ok: true, problems: [] }));
    typeDesigns("docs/pages");
    // Escape closes the dialog through its onOpenChange, as the close button does.
    act(() => useProject.getState().openSettings(false));
    await act(async () => {
      await fakeApi.requested("settings.set");
    });
    expect(sets()).toEqual([{ ...settings, designsDir: "docs/pages" }]);
  });

  it("a path is saved when its field is left, not as it is typed", async () => {
    fakeApi.respond("settings.set", () => ({ ok: true, problems: [] }));
    const input =
      container.querySelector<HTMLInputElement>("#settings-designs");
    if (!input) {
      throw new Error("no field");
    }
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, "docs/pages");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(sets()).toEqual([]);
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      await fakeApi.requested("settings.set");
    });
    expect(sets()).toEqual([{ ...settings, designsDir: "docs/pages" }]);
    expect(input.value).toBe("docs/pages");
  });

  it("a change that wasn't saved says why under its row", async () => {
    fakeApi.respond("settings.set", () => ({
      ok: false,
      problems: ["Settings were set in the meantime."],
    }));
    act(() => container.querySelector<HTMLElement>("#settings-git")?.click());
    await act(async () => {
      await fakeApi.requested("settings.set");
    });
    expect(
      row("settings-git")?.querySelector("[role=alert]")?.textContent
    ).toBe("Couldn’t save this change.Settings were set in the meantime.");
  });
});

describe("the settings before they are read", () => {
  let mounted: Root;
  let container: HTMLElement;

  beforeEach(() => {
    fakeApi.reset();
    useProject.setState({
      loadError: null,
      loaded: false,
      settings: null,
      settingsOpen: true,
      settingsSection: "repository",
    });
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => {
      mounted.render(<SettingsPage />);
    });
  });

  afterEach(() => {
    act(() => mounted.unmount());
  });

  it("show the sections and skeleton rows, not a blank page", () => {
    expect(
      container.querySelector("nav[aria-label='Settings sections']")
    ).not.toBeNull();
    expect(
      container.querySelector("[role=status][aria-busy=true]")
    ).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("list the sections a saved project has, so none appears when the read lands", async () => {
    const listed = () =>
      [
        ...container.querySelectorAll(
          "nav[aria-label='Settings sections'] button"
        ),
      ].map((b) => b.textContent);
    const before = listed();
    expect(before).toContain("Agents");
    fakeApi.respond("project.info", () => ({
      configured: true,
      settings: defaultSettings("/repo"),
      storage: { mode: "managed" },
    }));
    fakeApi.respond("pages.list", () => ({ canvases: [], pages: [] }));
    fakeApi.respond("edit.state", () => ({ canRedo: false, canUndo: false }));
    await act(async () => {
      await useProject.getState().load();
    });
    expect(useProject.getState().loaded).toBe(true);
    expect(listed()).toEqual(before);
  });

  it("say why a failed read failed, and Try again reads them", async () => {
    fakeApi.respond("project.info", () =>
      Promise.reject(new Error("the server is away"))
    );
    await act(async () => {
      await useProject.getState().load();
    });
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Couldn’t load the settings (the server is away).Try again"
    );
    const settings = defaultSettings("/repo");
    fakeApi.respond("project.info", () => ({
      configured: false,
      settings,
      storage: { mode: "ephemeral" },
    }));
    const tryAgain = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again"
    );
    await act(async () => {
      tryAgain?.click();
      await fakeApi.requested("project.info", 2);
    });
    expect(useProject.getState().loaded).toBe(true);
    expect(container.querySelector("#settings-designs")).not.toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
  });
});
