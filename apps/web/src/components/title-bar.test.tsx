// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { StorageInfo } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Unsaved } from "./title-bar.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;
const initial = useProject.getState();

const chipWith = (storage: StorageInfo) => {
  useProject.setState({
    info: { configured: true, name: "bike-shop", storage },
  });
  act(() => mounted.render(<Unsaved />));
  return container.textContent;
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  fakeApi.reset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  useProject.setState(initial, true);
});

describe("the title bar's Not saved chip", () => {
  it("shows only for a run that never saves", () => {
    expect(chipWith({ mode: "ephemeral" })).toBe("Not saved");
    expect(chipWith({ mode: "ephemeral", saveOnChange: true })).toBe("");
    expect(
      chipWith({ configPath: "/shop/ultrapaint.config.json", mode: "file" })
    ).toBe("");
  });
});

describe("the first change's save", () => {
  it("is said once, with the way to the settings", () => {
    const stop = followServer({ report: () => undefined });
    fakeApi.emit("settings.savedOnChange", {
      configPath: "/shop/ultrapaint.config.json",
      problems: [],
    });
    stop();
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [title, options] = vi.mocked(toast.success).mock.calls[0] ?? [];
    expect(title).toBe("Saved this folder’s settings");
    expect(options?.description).toBe(
      "In ultrapaint.config.json. Change them in Settings."
    );
    const action = options?.action as { label: string; onClick: () => void };
    expect(action.label).toBe("Settings");
    action.onClick();
    expect(useProject.getState().settingsOpen).toBe(true);
    expect(useProject.getState().settingsSection).toBe("repository");
  });

  it("says why when the folder refused it", () => {
    const stop = followServer({ report: () => undefined });
    fakeApi.emit("settings.savedOnChange", {
      problems: ["Couldn’t write /shop/ultrapaint.config.json: denied"],
    });
    stop();
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      "Couldn’t save this folder’s settings"
    );
  });
});
