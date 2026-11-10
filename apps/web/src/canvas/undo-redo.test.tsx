// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { UndoState } from "@ultrapaint/contracts/edit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { UndoRedo } from "./undo-redo.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const REASON = "designs/home.page.json changed outside the editor";

const initialProject = useProject.getState();

let mounted: Root;
let container: HTMLElement;

const draw = (undo: UndoState) => {
  useProject.setState({ undo });
  act(() => mounted.render(<UndoRedo />));
};

const button = (name: string) => {
  const found = [...container.querySelectorAll("button")].find((b) =>
    b.getAttribute("aria-label")?.startsWith(name)
  );
  if (!found) {
    throw new Error(`no ${name} button`);
  }
  return found;
};

/**
 * What the tooltip says once the mouse rests on the button; null when none opens. One a test: a
 * tooltip closed stays drawn while it leaves.
 */
const tooltipOf = (name: string) => {
  act(() => {
    button(name).dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true })
    );
  });
  return (
    document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? null
  );
};

beforeEach(() => {
  fakeApi.reset();
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useProject.setState(initialProject, true);
});

describe("Undo and Redo in the tools' row", () => {
  it("name the step each would take, Redo as Undo does", () => {
    draw({
      canRedo: true,
      canUndo: true,
      redoLabel: "Rename the page",
      undoLabel: "Move the title",
    });
    expect(tooltipOf("Redo")).toContain("Redo · Rename the page");
    expect(button("Redo").getAttribute("aria-label")).toBe(
      "Redo Rename the page"
    );
    expect(button("Undo").getAttribute("aria-label")).toBe(
      "Undo Move the title"
    );
  });

  it("say only their name when there is no step to name", () => {
    draw({ canRedo: false, canUndo: false });
    expect(button("Redo").getAttribute("aria-label")).toBe("Redo");
    expect(button("Undo").getAttribute("aria-label")).toBe("Undo");
    expect(button("Undo").hasAttribute("aria-description")).toBe(false);
  });

  it("say why the undo history was dropped, on Undo, which then does nothing", () => {
    draw({
      canRedo: false,
      canUndo: false,
      invalidated: { history: "undo", reason: REASON },
    });
    expect(tooltipOf("Undo")).toBe(`Nothing to undo: ${REASON}`);
    const undo = button("Undo");
    // Reachable, so the reason can be read, and still not a step to take.
    expect(undo.disabled).toBe(false);
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(undo.getAttribute("aria-description")).toBe(
      `Nothing to undo: ${REASON}`
    );
    act(() => undo.click());
    expect(fakeApi.calls).toEqual([]);
    // The redo history is as it was: Redo has nothing to say of it.
    expect(button("Redo").disabled).toBe(true);
    expect(button("Redo").hasAttribute("aria-description")).toBe(false);
  });

  it("say why the redo history was dropped, on Redo and not on Undo", () => {
    draw({
      canRedo: false,
      canUndo: false,
      invalidated: { history: "redo", reason: REASON },
    });
    expect(tooltipOf("Redo")).toBe(`Nothing to redo: ${REASON}`);
    expect(button("Undo").disabled).toBe(true);
    expect(button("Undo").hasAttribute("aria-description")).toBe(false);
  });

  it("name the step again once there is one, whatever was dropped before", () => {
    draw({
      canRedo: false,
      canUndo: true,
      invalidated: { history: "undo", reason: REASON },
      undoLabel: "Move the title",
    });
    expect(tooltipOf("Undo")).toContain("Undo · Move the title");
    expect(button("Undo").hasAttribute("aria-description")).toBe(false);
  });
});
