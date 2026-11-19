// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { usePanels } from "../state/panels.ts";
import { Rail } from "./rail.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

const PLAN = {
  name: "Plan",
  origin: "app",
  properties: [],
  slots: [],
  tree: { children: [], id: "plan-root", type: "column" },
  version: 1,
} as const;

const initialBoard = useBoard.getState();
const initialComponents = useComponents.getState();
const initialDesignSystem = useDesignSystem.getState();
const initialEditor = useEditor.getState();

const places = () =>
  [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  useBoard.setState(initialBoard, true);
  useComponents.setState(initialComponents, true);
});

afterEach(() => {
  act(() => root.render(null));
  useDesignSystem.setState(initialDesignSystem, true);
  useEditor.setState(initialEditor, true);
});

describe("the rail on an app component's board (ADR 0053)", () => {
  it("has Layers once the components are known, when the board was open before them", () => {
    useBoard.setState({ open: { item: "Plan", view: "library" } });
    act(() => root.render(<Rail />));
    expect(places()).not.toContain("Layers");
    act(() => useComponents.setState({ components: [PLAN] }));
    expect(places()).toContain("Layers");
  });
});

describe("the open panel's item clicked again (ADR 0086)", () => {
  it("takes the chat back to its list and keeps the panel", () => {
    useEditor.setState({ leftTab: "chat", workspace: "design" });
    usePanels.setState({ left: false });
    useAgents.setState({ current: "t1", view: "thread" });
    act(() => root.render(<Rail />));
    const agents = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Agents"]'
    );
    act(() => agents?.click());
    expect(useAgents.getState().view).toBe("list");
    expect(usePanels.getState().left).toBe(false);
  });
});

describe("Problems on the rail (ADR 0106)", () => {
  const withWarning = () =>
    useDesignSystem.setState({
      document: {
        body: "",
        findings: [
          {
            message: "No 'primary' color defined.",
            path: "colors",
            severity: "warning",
          },
        ],
        held: [],
        legacy: false,
        path: "DESIGN.md",
        sections: [],
        text: "",
      },
    });

  it("has no item while there is nothing to fix", () => {
    act(() => root.render(<Rail />));
    expect(places()).not.toContain("Problems");
  });

  it("has the item at its foot, over Changes, on the page canvas and on a board", () => {
    withWarning();
    act(() => root.render(<Rail />));
    const canvas = places();
    expect(canvas.indexOf("Problems")).toBe(canvas.indexOf("Changes") - 1);
    act(() => useBoard.setState({ open: { item: "color", view: "system" } }));
    const board = places();
    expect(board.indexOf("Problems")).toBe(board.indexOf("Changes") - 1);
  });

  it("opens Problems in the mode it is in", () => {
    withWarning();
    useBoard.setState({ open: { item: "color", view: "system" } });
    act(() => root.render(<Rail />));
    act(() =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Problems"]')
        ?.click()
    );
    expect(useEditor.getState().leftTab).toBe("problems");
    expect(useBoard.getState().open).toEqual({ item: "color", view: "system" });
  });
});
