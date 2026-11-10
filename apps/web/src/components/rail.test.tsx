// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
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

const places = () =>
  [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  useBoard.setState(initialBoard, true);
  useComponents.setState(initialComponents, true);
});

afterEach(() => {
  act(() => root.render(null));
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
