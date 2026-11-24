// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, usePreferences } from "../state/preferences.ts";
import { AppearanceSection } from "./settings-appearance.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Settings › Appearance's Agents at work", () => {
  let mounted: Root;
  let container: HTMLElement;

  const row = (setting: string) =>
    container.querySelector<HTMLElement>(`[data-setting="${setting}"]`);
  const button = (name: string) =>
    [...(row("agents-at-work")?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === name || b.getAttribute("aria-label") === name
    );

  beforeEach(() => {
    act(() => usePreferences.getState().setAll(DEFAULT_PREFERENCES));
    container = document.createElement("div");
    mounted = createRoot(container);
    act(() => mounted.render(<AppearanceSection />));
  });

  afterEach(() => {
    act(() => mounted.unmount());
    usePreferences.getState().setAll(DEFAULT_PREFERENCES);
  });

  it("sits under Motion", () => {
    const settings = [...container.querySelectorAll("[data-setting]")].map(
      (el) => el.getAttribute("data-setting")
    );
    expect(settings.indexOf("agents-at-work")).toBe(
      settings.indexOf("motion") + 1
    );
  });

  it("says what Calm does", () => {
    expect(row("agents-at-work")?.textContent).toContain(
      "Calm marks what an agent is changing with a still outline."
    );
  });

  it("has Animated picked, with no reset, until something else is", () => {
    expect(button("Animated")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Reset Agents at work to its default")).toBeUndefined();
  });

  it("keeps Calm the moment it is picked", () => {
    act(() => button("Calm")?.click());
    expect(usePreferences.getState().agentsAtWork).toBe("calm");
    expect(
      JSON.parse(localStorage.getItem("ultrapaint:preferences") ?? "{}")
    ).toMatchObject({ agentsAtWork: "calm" });
  });

  it("goes back to Animated by its reset", () => {
    act(() => button("Calm")?.click());
    act(() => button("Reset Agents at work to its default")?.click());
    expect(usePreferences.getState().agentsAtWork).toBe("animated");
  });
});
