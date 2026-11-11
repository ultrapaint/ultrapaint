// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addChip,
  dismissChip,
  nodeKey,
  pageChip,
  useAttachments,
} from "../state/attachments.ts";
import { useDocuments } from "../state/documents.ts";
import { setDraft, useDrafts } from "../state/drafts.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { ThreadList } from "./chat-list.tsx";
import { ChatStarters } from "./chat-starters.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const thread: Thread = {
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  status: "idle",
  title: "New chat",
  updatedAt: 0,
};

let mounted: Root;
let container: HTMLElement;

const opened = (setup: ProjectInfo["setup"]) => {
  useProject.setState({
    info: {
      configured: true,
      name: "bike-shop",
      setup,
      storage: { mode: "ephemeral" },
    } as ProjectInfo,
  });
  act(() => mounted.render(<ChatStarters thread={thread} />));
};

const starters = () =>
  [...container.querySelectorAll("button")].map((b) => b.textContent);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  fakeApi.reset();
  vi.mocked(showLeftPanel).mockReset();
  useAttachments.setState({ byThread: {}, dismissed: {} });
  useDocuments.setState({ docs: {} });
  useDrafts.setState({ byThread: {} });
  useEditor.setState({ selection: null });
  useProject.setState({ pages: [] });
});

const page = (name: string, route: string): Page => ({
  canvas: "",
  file: `designs/${name}.page.json`,
  id: name,
  name,
  path: `${name}.page.json`,
  route,
});

const node = (nodeId: string) => ({
  component: false,
  file: "designs/home.page.json",
  frame: "home",
  kind: "node" as const,
  name: nodeId,
  nodeId,
});

describe("a new chat's starters", () => {
  it("suggest setting up a folder whose settings were detected, sending nothing", () => {
    opened("detected");
    expect(starters()[0]).toBe("Set up bike-shop");
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(showLeftPanel).toHaveBeenCalledWith({
      chat: "t1",
      draft: "/setup",
    });
    expect(fakeApi.calls).toEqual([]);
  });

  it("suggest no setup once the settings are saved", () => {
    opened("saved");
    expect(starters()).not.toContain("Set up bike-shop");
  });
});

describe("a new chat's starters and its draft", () => {
  it("are offered only while nothing is typed, so none takes the place of a draft", () => {
    opened("saved");
    expect(starters()).toContain("Design a new page for…");
    act(() => setDraft(thread.id, "Make the header"));
    expect(starters()).toEqual([]);
    act(() => setDraft(thread.id, ""));
    expect(starters()).toContain("Design a new page for…");
  });
});

describe("a new chat's starters on what is attached", () => {
  it("offer a page attached its own implementation, by its URL", () => {
    const vibe = page("Vibe", "/vibe");
    useProject.setState({ pages: [vibe] });
    addChip(thread.id, pageChip(vibe));
    opened("saved");
    expect(starters()).toEqual([
      "Make three variants of it",
      "Design its empty, loading and error states",
      "Match it to the design system",
      "Implement it",
    ]);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Implement it")
        ?.click()
    );
    expect(showLeftPanel).toHaveBeenCalledWith({
      chat: "t1",
      draft: "/implement /vibe",
    });
  });

  it("speak of several elements as them", () => {
    addChip(thread.id, node("a"));
    addChip(thread.id, node("b"));
    opened("saved");
    expect(starters()).toEqual([
      "Make three variants of each",
      "Design their empty, loading and error states",
      "Match them to the design system",
      "Implement them as components",
    ]);
  });
});

describe("a new chat's starters on what is selected", () => {
  it("follow the selection while the composer takes it along, and leave it once taken out", () => {
    const home = page("home", "/");
    const root = {
      children: [{ id: "cta", text: "Buy", type: "text" }],
      id: "root",
      type: "page",
    } as unknown as DesignNode;
    useProject.setState({ pages: [home] });
    useDocuments.setState({ docs: { home: { doc: "home", hash: "h", root } } });
    useEditor.setState({
      activePage: null,
      selection: { frame: "home", nodeId: "cta" },
    });
    opened("saved");
    expect(starters()).toContain("Implement it as a component");

    // The composer's chip of it removed: the prompt no longer speaks of it.
    act(() => dismissChip(thread.id, nodeKey("home", "cta")));
    expect(starters()).toContain("Design a new page for…");
    expect(starters()).not.toContain("Implement it as a component");
  });
});

describe("the agents' list with no chats", () => {
  it("suggests a detected folder's setup, drafted in a new chat and not sent", async () => {
    fakeApi.respond("threads.create", () => thread);
    const shown = new Promise((resolve) => {
      // The chat panel first, then the new chat with its draft.
      vi.mocked(showLeftPanel).mockImplementation((to) => {
        if (typeof to === "object") {
          resolve(to);
        }
        return Promise.resolve();
      });
    });
    useProject.setState({
      info: {
        configured: true,
        name: "bike-shop",
        setup: "detected",
        storage: { mode: "ephemeral" },
      } as ProjectInfo,
    });
    act(() => mounted.render(<ThreadList />));
    const setUp = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Set up bike-shop"
    );
    act(() => setUp?.click());
    expect(await shown).toEqual({ chat: thread, draft: "/setup " });
    expect(fakeApi.calls.map((c) => c.method)).toEqual(["threads.create"]);
  });
});
