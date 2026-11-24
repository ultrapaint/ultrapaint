// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWork } from "../state/agents.ts";
import { useEditor } from "../state/editor.ts";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  usePreferences,
} from "../state/preferences.ts";
import { AgentWorkOverlay } from "./agent-work.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The computer's Reduce motion setting, as a test sets it, telling its listeners. */
const system = {
  listeners: new Set<() => void>(),
  reduces: false,
  set(reduces: boolean) {
    this.reduces = reduces;
    for (const listener of this.listeners) {
      listener();
    }
  },
};

const FRAME = "home.page.json";

describe("an agent's work on the canvas, by how the person draws it", () => {
  let mounted: Root;
  let container: HTMLElement;

  const draw = (work: Partial<AgentWork> = {}) =>
    act(() =>
      mounted.render(
        <AgentWorkOverlay
          frameId={FRAME}
          pieces={[
            {
              nodeIds: ["title"],
              threadId: "thread_1",
              work: {
                doc: FRAME,
                done: false,
                intent: [],
                nodeIds: ["title"],
                ...work,
              },
            },
          ]}
        />
      )
    );
  const prefer = (p: Partial<Preferences>) =>
    act(() =>
      usePreferences.getState().setAll({ ...DEFAULT_PREFERENCES, ...p })
    );
  const outline = () =>
    container.querySelector<HTMLElement>('[data-agent-work="thread_1"]');
  const sweeps = () => container.querySelector(".animate-agent-sweep") !== null;

  beforeEach(() => {
    system.listeners.clear();
    system.reduces = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      addEventListener: (_: string, l: () => void) => system.listeners.add(l),
      get matches() {
        return query.includes("reduce") && system.reduces;
      },
      removeEventListener: (_: string, l: () => void) =>
        system.listeners.delete(l),
    }));
    useEditor.setState({
      rects: { [FRAME]: { title: { height: 40, width: 200, x: 10, y: 20 } } },
    });
    container = document.createElement("div");
    mounted = createRoot(container);
  });

  afterEach(() => {
    act(() => mounted.unmount());
    vi.unstubAllGlobals();
    prefer({});
    useEditor.setState({ rects: {} });
  });

  it("passes a light through it under Animated, Full drawing it even when the computer asks for reduced motion", () => {
    system.reduces = true;
    prefer({ agentsAtWork: "animated", motion: "full" });
    draw();
    expect(sweeps()).toBe(true);
  });

  it("keeps the agent's tag and its action under Calm", () => {
    prefer({ agentsAtWork: "calm" });
    draw({ action: "Editing the title" });
    expect(outline()?.textContent).toContain("Editing the title");
  });

  it("is a still outline under Calm", () => {
    prefer({ agentsAtWork: "calm" });
    draw();
    expect(outline()?.style.outlineColor).toBe("var(--agent)");
    expect(sweeps()).toBe(false);
    // No gradient stopped in place either: the outline holds nothing.
    expect(outline()?.querySelector("[class*='gradient']")).toBeNull();
  });

  it("is a still outline under Reduced motion, never a gradient stopped in place", () => {
    prefer({ motion: "reduced" });
    draw();
    expect(outline()?.style.outlineColor).toBe("var(--agent)");
    expect(sweeps()).toBe(false);
    expect(outline()?.querySelector("[class*='gradient']")).toBeNull();
  });

  it("goes still under System the moment the computer asks for reduced motion", () => {
    draw();
    expect(sweeps()).toBe(true);
    act(() => system.set(true));
    expect(sweeps()).toBe(false);
    expect(outline()).not.toBeNull();
  });

  it("still says Changed once the turn ended, under Calm", () => {
    prefer({ agentsAtWork: "calm" });
    draw({ done: true });
    expect(outline()?.textContent).toContain("Changed");
  });
});
