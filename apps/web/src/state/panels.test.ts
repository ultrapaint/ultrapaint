import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { Thread } from "@ultrapaint/contracts/threads";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addToChat } from "../lib/add-to-chat.ts";
import { openCanvas } from "../lib/canvas-actions.ts";
import { renameNode } from "../lib/node-actions.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useAgents } from "./agents.ts";
import { useAttachments } from "./attachments.ts";
import { openBoard, useBoard } from "./board.ts";
import { measureViewportWith } from "./camera.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import {
  showLeftPanel,
  showMode,
  startRightPanel,
  takeRequest,
  usePanels,
} from "./panels.ts";
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
const initialBoard = useBoard.getState();

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("threads.items", () => []);
  prompted.count = 0;
  // Every panel put away, the right one too.
  usePanels.setState({ left: true, right: true, rightWaits: false });
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
  useBoard.setState(initialBoard, true);
  useEditor.setState(initial, true);
  useEditor.setState({ canvas: "", leftTab: "layers", workspace: "design" });
  measureViewportWith(() => ({ height: 800, width: 1000, x: 300 }));
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

  it("opens Design system's board view, on the item it showed last", async () => {
    await showLeftPanel("designSystem");
    expect(useBoard.getState().open).toEqual({ item: "color", view: "system" });
    expect(useEditor.getState().leftTab).toBe("designSystem");
    openBoard({ item: "radius", view: "system" });
    openBoard({ item: "Button", view: "library" });
    await showLeftPanel("designSystem");
    expect(useBoard.getState().open).toEqual({
      item: "radius",
      view: "system",
    });
  });

  it("shows the Library's insert list on the page, and its board view's navigation on one", async () => {
    await showLeftPanel("library");
    expect(useBoard.getState().open).toBeNull();
    expect(useEditor.getState().leftTab).toBe("library");
    await showLeftPanel("designSystem");
    await showLeftPanel("library");
    expect(useBoard.getState().open).toEqual({
      item: "overview",
      view: "library",
    });
  });

  it("keeps a board view for the chat, and leaves it for Layers", async () => {
    await showLeftPanel("designSystem");
    await showLeftPanel("chat");
    expect(useBoard.getState().open).not.toBeNull();
    expect(useEditor.getState().leftTab).toBe("chat");
    await showLeftPanel("layers");
    expect(useBoard.getState().open).toBeNull();
    expect(useEditor.getState().leftTab).toBe("layers");
  });

  it("switches between Canvas and Design System, the page found as it was left", async () => {
    useEditor.setState({ leftTab: "layers" });
    await showMode("designSystem");
    expect(useBoard.getState().open).toEqual({ item: "color", view: "system" });
    expect(useEditor.getState().leftTab).toBe("designSystem");
    await showMode("canvas");
    expect(useBoard.getState().open).toBeNull();
    expect(useEditor.getState().leftTab).toBe("layers");
  });

  it("goes back to Canvas mode when the canvas shown is picked again", async () => {
    await showMode("designSystem");
    openCanvas(useEditor.getState().canvas ?? "");
    expect(useBoard.getState().open).toBeNull();
  });

  it("takes Canvas mode back from the prototype", async () => {
    useEditor.setState({ workspace: "prototype" });
    await showMode("canvas");
    expect(useEditor.getState().workspace).toBe("design");
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

describe("the right panel as the editor starts", () => {
  it("waits for something to be selected, then comes out", () => {
    usePanels.setState({ right: true, rightWaits: true });
    useEditor.setState({ selectedPage: null, selection: null });
    const stop = startRightPanel();
    expect(usePanels.getState().right).toBe(true);
    useEditor.setState({ selection: { frame: HOME, nodeId: "home" } });
    expect(usePanels.getState().right).toBe(false);
    // Once out, it is the user's: put away, it stays away whatever is selected next.
    usePanels.getState().toggleRight();
    useEditor.setState({ selection: null });
    useEditor.setState({ selection: { frame: HOME, nodeId: "home" } });
    expect(usePanels.getState().right).toBe(true);
    stop();
  });

  it("comes out for a board view, whose inspector always has something", () => {
    usePanels.setState({ right: true, rightWaits: true });
    useEditor.setState({ selectedPage: null, selection: null });
    const stop = startRightPanel();
    openBoard({ item: "color", view: "system" }, "none");
    expect(usePanels.getState().right).toBe(false);
    stop();
  });

  it("stays away when the user put it away, a selection or not", () => {
    usePanels.setState({ right: true, rightWaits: false });
    const stop = startRightPanel();
    useEditor.setState({ selection: { frame: HOME, nodeId: "home" } });
    expect(usePanels.getState().right).toBe(true);
    stop();
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
