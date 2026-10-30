import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { Thread } from "@ultrapaint/contracts/threads";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addToChat } from "../lib/add-to-chat.ts";
import { renameNode } from "../lib/node-actions.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useAgents } from "./agents.ts";
import { useAttachments } from "./attachments.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { showLeftPanel, takeRequest, usePanels } from "./panels.ts";
import { useProject } from "./project.ts";

const prompted = vi.hoisted(() => ({ count: 0 }));

vi.mock("../components/dialogs.tsx", async (original) => ({
  ...(await original<typeof import("../components/dialogs.tsx")>()),
  promptDialog: () => {
    prompted.count += 1;
    return Promise.resolve(null);
  },
}));

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";
const HERO = { frame: HOME, nodeId: "hero" };

const thread = (id: string): Thread => ({
  agentId: "fake",
  createdAt: 0,
  id,
  status: "idle",
  title: "Work",
  updatedAt: 0,
});

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [{ id: "hero", role: "heading", text: "Hi", type: "text" }],
    id: "home",
    type: "page",
  } as DocumentState["root"],
};

/** The transcripts the chat read, by thread. */
const read = () =>
  fakeApi.calls
    .filter((c) => c.method === "threads.items")
    .map((c) => (c.input as { threadId: string }).threadId);

const initial = useEditor.getState();

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("threads.items", () => []);
  prompted.count = 0;
  // Every panel put away, the right one too.
  usePanels.setState({ left: true, right: true });
  useAttachments.setState({ byThread: {} });
  useProject.setState({
    pages: [
      {
        canvas: "",
        file: `designs/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
      },
    ],
  });
  useDocuments.setState({ canvas: "", docs: { [HOME]: home } });
  useEditor.setState(initial, true);
  useEditor.setState({ canvas: "", leftTab: "layers", workspace: "design" });
  useAgents.setState({
    current: "t1",
    threads: [thread("t1"), thread("t2")],
    view: "thread",
  });
  for (const requested of ["diff", "rename", { draft: "t2" }] as const) {
    takeRequest(requested);
  }
});

describe("showLeftPanel", () => {
  it("shows a tab, the panel brought back and the canvas left as it is", async () => {
    await showLeftPanel("library");
    expect(useEditor.getState().leftTab).toBe("library");
    expect(usePanels.getState()).toMatchObject({ left: false, right: true });
  });

  it("brings the canvas back from the prototype", async () => {
    useEditor.setState({ workspace: "prototype" });
    await showLeftPanel("designSystem");
    expect(useEditor.getState()).toMatchObject({
      leftTab: "designSystem",
      workspace: "design",
    });
  });

  it("opens a thread in the chat, its draft in its composer once", async () => {
    await showLeftPanel({ chat: "t2", draft: "/init " });
    expect(useEditor.getState().leftTab).toBe("chat");
    expect(usePanels.getState().left).toBe(false);
    expect(useAgents.getState()).toMatchObject({
      current: "t2",
      view: "thread",
    });
    expect(read()).toEqual(["t2"]);
    expect(takeRequest({ draft: "t2" })).toBe("/init ");
    expect(takeRequest({ draft: "t2" })).toBeNull();
  });

  it("leaves the thread open as it is, its draft for its composer", async () => {
    await showLeftPanel({ chat: "t1", draft: "Make it blue" });
    expect(read()).toEqual([]);
    expect(takeRequest({ draft: "t1" })).toBe("Make it blue");
  });

  it("shows a thread just created without reading its transcript", async () => {
    await showLeftPanel({ chat: thread("t3"), draft: "/implement " });
    expect(useAgents.getState()).toMatchObject({
      current: "t3",
      view: "thread",
    });
    expect(read()).toEqual([]);
    expect(takeRequest({ draft: "t3" })).toBe("/implement ");
  });

  it("opens Changes on a file, the last one asked for, taken once", async () => {
    await showLeftPanel({ changes: "src/app.tsx" });
    await showLeftPanel({ changes: "src/page.tsx" });
    expect(useEditor.getState().leftTab).toBe("changes");
    expect(usePanels.getState().left).toBe(false);
    expect(takeRequest("diff")).toBe("src/page.tsx");
    expect(takeRequest("diff")).toBeNull();
  });

  it("asks Layers to rename a node in its row", async () => {
    await showLeftPanel({ layers: { rename: HERO } });
    expect(useEditor.getState().leftTab).toBe("layers");
    expect(takeRequest("rename")).toEqual(HERO);
    expect(takeRequest("rename")).toBeNull();
  });
});

describe("Add to chat", () => {
  it("with the left panel put away shows the chat it added to", async () => {
    await addToChat(HERO);
    expect(useAttachments.getState().byThread.t1).toHaveLength(1);
    expect(useEditor.getState().leftTab).toBe("chat");
    expect(usePanels.getState().left).toBe(false);
  });
});

describe("Rename", () => {
  it("types into the node's Layers row while Layers is on screen", async () => {
    usePanels.setState({ left: false });
    await renameNode(HERO);
    expect(takeRequest("rename")).toEqual(HERO);
    expect(prompted.count).toBe(0);
  });

  it("with Layers put away asks in a dialog", async () => {
    await renameNode(HERO);
    expect(takeRequest("rename")).toBeNull();
    expect(prompted.count).toBe(1);
    expect(usePanels.getState().left).toBe(true);
  });

  it("with another panel on screen asks in a dialog", async () => {
    usePanels.setState({ left: false });
    useEditor.setState({ leftTab: "library" });
    await renameNode(HERO);
    expect(takeRequest("rename")).toBeNull();
    expect(prompted.count).toBe(1);
  });
});
