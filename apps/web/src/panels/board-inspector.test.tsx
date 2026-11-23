// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type { Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Pick, pickId } from "../boards/pick.ts";
import { menuFor } from "../lib/menu-actions.ts";
import {
  type BoardPlace,
  openBoard,
  pickOnBoard,
  useBoard,
} from "../state/board.ts";
import { useContextMenu } from "../state/context-menu.ts";
import { draftEdits, useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { useImplementation } from "../state/implementation.ts";
import { takeRequest } from "../state/panels.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { BoardInspector } from "./board-inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Two colour groups, each a palette with one shade. */
const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    { name: "Blue", tokens: [{ name: "color-blue-500", value: "#3b82f6" }] },
    { name: "Red", tokens: [{ name: "color-red-500", value: "#ef4444" }] },
  ],
};

/** The Color foundation's boards, where the groups and their tokens are picked. */
const COLOR: BoardPlace = { item: "color", view: "system" };

const initialEditor = useEditor.getState();
const initialBoard = useBoard.getState();
const initialDesignSystem = useDesignSystem.getState();
const initialImplementation = useImplementation.getState();

let mounted: Root;
let container: HTMLElement;

/** Picks what a node of the Color boards stands for, as a click on it does. */
const pick = (picked: Pick) =>
  act(() => pickOnBoard({ frame: "board", nodeId: pickId(picked) }));

const field = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name
  );

beforeEach(async () => {
  fakeApi.reset();
  fakeApi.respond("designSystem.get", () => ({
    designSystem: ds,
    document: null,
  }));
  useEditor.setState(initialEditor, true);
  useEditor.setState({ canvas: "main", workspace: "design" });
  useBoard.setState(initialBoard, true);
  await useDesignSystem.getState().load();
  openBoard(COLOR);
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => mounted.render(<BoardInspector open={COLOR} />));
});

afterEach(() => {
  act(() => mounted.unmount());
  draftEdits(null);
  useDesignSystem.setState(initialDesignSystem, true);
  useImplementation.setState(initialImplementation, true);
});

describe("Design system's inspector, from one pick to the next", () => {
  it("starts the token added to a group from that group's prefix", () => {
    pick({ kind: "group", name: "Blue" });
    expect(field("The new token's name")?.value).toBe("color-blue-");
    pick({ kind: "group", name: "Red" });
    expect(field("The new token's name")?.value).toBe("color-red-");
  });

  it("leaves a ramp proposed for one token behind with it", () => {
    pick({ kind: "token", name: "color-blue-500" });
    act(() => button("Generate ramp…")?.click());
    expect(button("Apply ramp")).toBeDefined();
    pick({ kind: "token", name: "color-red-500" });
    expect(button("Apply ramp")).toBeUndefined();
    expect(button("Generate ramp…")).toBeDefined();
    // The shades drawn over the board went with it.
    expect(useDesignSystem.getState().designSystem).toEqual(ds);
  });
});

/** The Button's board in the Library. */
const BUTTON: BoardPlace = { item: "Button", view: "library" };

/** The Button implemented by ui/button.tsx, its code changed since or not. */
const buttonImplemented = (codeChanged: boolean) =>
  useImplementation.setState({
    byTarget: {
      "component:Button": {
        at: 0,
        changedFiles: codeChanged ? ["ui/button.tsx"] : [],
        codeChanged,
        designChanged: false,
        files: ["ui/button.tsx"],
        kind: "component",
        name: "Button",
        ready: false,
        status: codeChanged ? "changed" : "implemented",
        target: "component:Button",
      } satisfies ImplementationItem,
    },
  });

/** The board's ⋯ menu, opened: its items' names. */
/** The board's "…" opened: the labels of the menu it shows, the Library row's own (ADR 0102). */
const boardMenuItems = () => {
  act(() =>
    container.querySelector<HTMLElement>('[aria-label="More"]')?.click()
  );
  const { request } = useContextMenu.getState();
  return (request ? (menuFor(request.target) ?? []) : [])
    .filter((e) => e.kind === "item")
    .map((e) => e.label);
};

describe("a component's Update from code (ADR 0122)", () => {
  const openButton = () => {
    openBoard(BUTTON);
    act(() => mounted.render(<BoardInspector open={BUTTON} />));
  };

  it("reads Code changed on its board, and offers Update from code there and in its menu", () => {
    buttonImplemented(true);
    openButton();
    expect(container.textContent).toContain("Code changed");
    expect(button("Update from code")).toBeDefined();
    expect(boardMenuItems()).toContain("Update from code");
  });

  it("is not offered for a component implemented with nothing changed", () => {
    buttonImplemented(false);
    openButton();
    expect(container.textContent).toContain("Implemented");
    expect(button("Update from code")).toBeUndefined();
    expect(boardMenuItems()).not.toContain("Update from code");
  });

  it("drafts the task in a new chat, and sends nothing (ADR 0074)", async () => {
    const thread: Thread = {
      agentId: "claude-code",
      createdAt: 0,
      id: "t1",
      status: "idle",
      title: "New chat",
      updatedAt: 0,
    };
    fakeApi.respond("threads.create", () => thread);
    buttonImplemented(true);
    openButton();
    act(() => button("Update from code")?.click());
    await act(() => fakeApi.requested("threads.create"));
    await act(async () => undefined);
    expect(takeRequest({ draft: thread.id })).toBe(
      "/update-from-code component:Button "
    );
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("threads.prompt");
  });
});
