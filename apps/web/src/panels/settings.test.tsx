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
    expect(buttons).toContain("Done");
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
