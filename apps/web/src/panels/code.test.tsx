// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type { Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { viewFrameOf } from "../state/frame-ref.ts";
import { useImplementation } from "../state/implementation.ts";
import { takeRequest } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { select } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { CodePanel } from "./code.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [text("title"), text("lede")],
    id: "home",
    type: "page",
  } as DesignNode,
};

const initialEditor = useEditor.getState();
const initialProject = useProject.getState();

let mounted: Root;
let container: HTMLElement;

/** Selects a node and waits for the answer about its code to be drawn. */
const selectAndRead = async (nodeId: string, asked: number, frame = HOME) => {
  act(() => select({ frame, nodeId }));
  await act(() => fakeApi.requested("code.write", asked));
};

beforeEach(() => {
  fakeApi.reset();
  // The title's code is written; the lede's cannot be.
  fakeApi.respond("code.write", ({ node }) =>
    node.id === "title"
      ? { code: "<p>the title's code</p>", language: "tsx" }
      : Promise.reject(new RequestError("internal", "no code"))
  );
  useEditor.setState(initialEditor, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  useProject.setState(initialProject, true);
  useImplementation.setState({ byTarget: {} });
  useProject.setState({
    pages: [
      {
        canvas: "main",
        file: `designs/main/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
        route: "/orders",
      },
    ],
  });
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => mounted.render(<CodePanel />));
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("the code of the node selected", () => {
  it("is not the last node's when its own could not be written", async () => {
    await selectAndRead("title", 1);
    expect(container.textContent).toContain("the title's code");
    await selectAndRead("lede", 2);
    expect(container.textContent).toContain("Couldn’t write the code");
    expect(container.textContent).not.toContain("the title's code");
  });

  it("is asked for in its canvas, whose pages its links lead to", async () => {
    await selectAndRead("title", 1);
    expect(fakeApi.calls.at(-1)).toMatchObject({
      input: { canvas: "main", node: { id: "title" } },
      method: "code.write",
    });
  });

  it("names a page's component in a view of the page as in its own frame", async () => {
    await selectAndRead("home", 1, viewFrameOf(HOME, "tablet"));
    expect(fakeApi.calls.at(-1)?.input).toMatchObject({
      component: "OrdersPage",
    });
  });
});

describe("a page's implementation", () => {
  it("is in the Code tab with the page's code", async () => {
    await selectAndRead("home", 1);
    expect(container.textContent).toContain("Not implemented");
    expect(container.textContent).toContain("Implement");
  });

  it("keeps its rare actions in its menu: Implement is the one in view", async () => {
    await selectAndRead("home", 1);
    expect(container.textContent).not.toContain("Mark implemented");
    expect(container.textContent).not.toContain("Mark ready");
    expect(
      container.querySelector('[aria-label="More implementation actions"]')
    ).not.toBeNull();
  });

  it("is not shown for a node inside the page", async () => {
    await selectAndRead("title", 1);
    expect(container.textContent).not.toContain("Implementation");
  });
});

/** Home linked to its code, where the code, the design or both changed since. */
const linked = (changed: { code: boolean; design: boolean }) =>
  useImplementation.setState({
    byTarget: {
      [HOME]: {
        changedFiles: changed.code ? ["src/orders.tsx"] : [],
        codeChanged: changed.code,
        designChanged: changed.design,
        files: ["src/orders.tsx"],
        kind: "page",
        name: "Home",
        ready: false,
        status: changed.code || changed.design ? "changed" : "implemented",
        target: HOME,
      } satisfies ImplementationItem,
    },
  });

const buttonNamed = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

/** The Implementation section's menu, opened: its items' names. */
const menuItems = () => {
  act(() =>
    (
      container.querySelector(
        '[aria-label="More implementation actions"]'
      ) as HTMLElement | null
    )?.click()
  );
  return [...document.body.querySelectorAll("[role=menuitem]")].map(
    (i) => i.textContent
  );
};

describe("a page's Update from code (ADR 0115)", () => {
  it("is a button when the page's code changed since it was implemented", async () => {
    linked({ code: true, design: false });
    await selectAndRead("home", 1);
    expect(buttonNamed("Update from code")).toBeDefined();
    expect(container.textContent).not.toContain("reconciles both");
  });

  it("says the agent reconciles both when the design changed too", async () => {
    linked({ code: true, design: true });
    await selectAndRead("home", 1);
    expect(buttonNamed("Update from code")).toBeDefined();
    expect(container.textContent).toContain(
      "The design changed too: the agent reconciles both, and asks you where it can't tell."
    );
  });

  it("is in the menu only, beside finding its code, for a page not linked yet", async () => {
    await selectAndRead("home", 1);
    expect(buttonNamed("Update from code")).toBeUndefined();
    const items = menuItems();
    expect(items).toContain("Find its code with an agent");
    expect(items).toContain("Update from code");
  });

  it("is not offered for a page implemented with nothing changed, nor one whose design alone changed", async () => {
    linked({ code: false, design: false });
    await selectAndRead("home", 1);
    expect(buttonNamed("Update from code")).toBeUndefined();
    expect(menuItems()).not.toContain("Update from code");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    linked({ code: false, design: true });
    await act(async () => undefined);
    expect(buttonNamed("Update from code")).toBeUndefined();
    expect(menuItems()).not.toContain("Update from code");
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
    linked({ code: true, design: false });
    await selectAndRead("home", 1);
    act(() => buttonNamed("Update from code")?.click());
    await act(() => fakeApi.requested("threads.create"));
    await act(async () => undefined);
    expect(takeRequest({ draft: thread.id })).toBe(
      `/update-from-code ${HOME} `
    );
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("threads.prompt");
  });
});
