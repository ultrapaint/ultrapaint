// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { StorageInfo } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import {
  RightPanelPutAway,
  RightPanelToggle,
  RightTabsList,
  Unsaved,
} from "./title-bar.tsx";
import { Tabs } from "./ui/tabs.tsx";

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
const initialEditor = useEditor.getState();
const initialPanels = usePanels.getState();

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
  useEditor.setState(initialEditor, true);
  usePanels.setState(initialPanels, true);
  localStorage.clear();
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

describe("the right panel put away (ADR 0127)", () => {
  const putAway = (tabs: boolean) => {
    useEditor.setState({ rightTab: "design", workspace: "design" });
    usePanels.setState({ right: true });
    act(() => mounted.render(<RightPanelPutAway tabs={tabs} />));
  };
  const tab = (name: string) =>
    [...container.querySelectorAll<HTMLElement>("[role=tab]")].find(
      (t) => t.textContent === name
    );
  const buttons = () =>
    [...container.querySelectorAll("button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent
    );

  it("is its tabs' row, none of them open, and the toggle that shows it", () => {
    putAway(true);
    expect(buttons()).toEqual(["Design", "Code", "Show the right panel"]);
    expect(
      container.querySelectorAll("[role=tab][aria-selected=true]")
    ).toHaveLength(0);
  });

  it("brings the panel back on the tab clicked", () => {
    putAway(true);
    act(() => tab("Code")?.click());
    expect(usePanels.getState().right).toBe(false);
    expect(useEditor.getState().rightTab).toBe("code");
  });

  it("brings the panel back on the tab it had from its toggle", () => {
    putAway(true);
    act(() =>
      container
        .querySelector<HTMLElement>('[aria-label="Show the right panel"]')
        ?.click()
    );
    expect(usePanels.getState().right).toBe(false);
    expect(useEditor.getState().rightTab).toBe("design");
  });

  it("is the toggle alone where the panel has no tabs", () => {
    putAway(false);
    expect(buttons()).toEqual(["Show the right panel"]);
  });
});

describe("the focus as the right panel comes and goes (ADR 0127)", () => {
  /** The panel's top row, out or put away, as the editor draws it. */
  const Panel = () => {
    const hidden = usePanels((s) => s.right);
    const tab = useEditor((s) => s.rightTab);
    return hidden ? (
      <RightPanelPutAway tabs />
    ) : (
      <Tabs value={tab}>
        <RightTabsList />
        <RightPanelToggle />
      </Tabs>
    );
  };
  const draw = (putAway: boolean) => {
    useEditor.setState({ rightTab: "design", workspace: "design" });
    usePanels.setState({ right: putAway });
    act(() => mounted.render(<Panel />));
  };
  const press = (selector: string) => {
    const control = container.querySelector<HTMLElement>(selector);
    control?.focus();
    act(() => control?.click());
  };
  const focused = () =>
    document.activeElement?.getAttribute("aria-label") ??
    document.activeElement?.textContent;

  it("goes to the tab a put-away tab brought the panel back on", () => {
    draw(true);
    press("[role=tab]:nth-child(2)");
    expect(focused()).toBe("Code");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  });

  it("stays on the toggle as the panel is shown and put away", () => {
    draw(true);
    press('[aria-label="Show the right panel"]');
    expect(focused()).toBe("Hide the right panel");
    press('[aria-label="Hide the right panel"]');
    expect(focused()).toBe("Show the right panel");
  });
});
