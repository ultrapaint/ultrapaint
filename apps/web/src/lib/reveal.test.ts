import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { CanvasLayout, Page } from "@ultrapaint/contracts/pages";
import type { Thread } from "@ultrapaint/contracts/threads";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { measureViewportWith } from "../state/camera.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { showScope } from "./add-to-chat.ts";
import { reveal } from "./reveal.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const page = (id: string, canvas: string, route: string): Page => ({
  canvas,
  file: `designs/${id}`,
  id,
  name: id,
  path: id,
  route,
});

const home = page("home.page.json", "main", "/");
const about = page("about.page.json", "other", "/about");

const frameAt = (x: number) => ({
  height: 400,
  preset: "custom" as const,
  width: 800,
  x,
  y: 0,
});

const mainLayout: CanvasLayout = {
  frames: { [home.id]: frameAt(0) },
  version: 1,
};
const otherLayout: CanvasLayout = {
  frames: { [about.id]: frameAt(1000) },
  version: 1,
};

/** What of the canvas is seen: 800 by 400 once the 60 of margin a fit keeps is taken off. */
const VIEWPORT = { height: 520, width: 920, x: 0 };
const START = { x: 0, y: 0, zoom: 1 };
/** Each page's frame fitted into the viewport. */
const HOME_IN_VIEW = { x: 60, y: 60, zoom: 1 };
const ABOUT_IN_VIEW = { x: -940, y: 60, zoom: 1 };

const CANVAS = canvasDocOf("main");
const canvasDoc: DocumentState = {
  doc: CANVAS,
  hash: `${CANVAS}@0`,
  root: {
    children: [
      {
        height: 40,
        id: "n1",
        role: "paragraph",
        text: "Hi",
        type: "text",
        width: 50,
        x: 100,
        y: 100,
      },
    ],
    id: "canvas-root",
    type: "group",
  } as DocumentState["root"],
};
/** The canvas `other`'s nodes beside its pages: a card holding a title. */
const OTHER_CANVAS = canvasDocOf("other");
const otherCanvasDoc: DocumentState = {
  doc: OTHER_CANVAS,
  hash: `${OTHER_CANVAS}@0`,
  root: {
    children: [
      {
        children: [{ id: "n3", role: "heading", text: "Card", type: "text" }],
        height: 100,
        id: "n2",
        type: "group",
        width: 200,
        x: 2000,
        y: 0,
      },
    ],
    id: "canvas-root",
    type: "group",
  } as DocumentState["root"],
};

/** The node beside the pages fitted: as close as the camera goes, 4. */
const NODE_IN_VIEW = { x: -40, y: -220, zoom: 4 };

const thread = (scope: Thread["scope"]): Thread => ({
  agentId: "fake",
  createdAt: 0,
  id: "t1",
  scope,
  status: "idle",
  title: "Work",
  updatedAt: 0,
});

/** Lets every answer on its way land: a canvas's layout, its documents. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const initial = useEditor.getState();
/** The canvas on screen, measured as `VIEWPORT`; called, it leaves the screen. */
let hideCanvas: () => void = () => undefined;

beforeEach(async () => {
  fakeApi.reset();
  fakeApi.respond("canvas.get", ({ canvas }) =>
    canvas === "other" ? otherLayout : mainLayout
  );
  fakeApi.respond("documents.list", () => []);
  useProject.setState({
    canvases: [
      { home: "/", id: "main", name: "Main", variants: [] },
      { home: "/about", id: "other", name: "Other", variants: [] },
    ],
    pages: [home, about],
  });
  useEditor.setState(initial, true);
  hideCanvas();
  await goTo({ canvas: "main" });
  await settle();
  useEditor.setState({ view: START, workspace: "design" });
  hideCanvas = measureViewportWith(() => VIEWPORT);
});

describe("reveal", () => {
  it("brings a page of the open canvas into view, selected", async () => {
    await reveal({ page: home.id });
    expect(useEditor.getState().selectedPage).toBe(home.id);
    expect(useEditor.getState().view).toEqual(HOME_IN_VIEW);
  });

  it("goes to the canvas a page is on", async () => {
    await reveal({ frame: about.id, nodeId: "title" });
    const editor = useEditor.getState();
    expect(editor.canvas).toBe("other");
    expect(editor.activePage).toBe(about.id);
    expect(editor.selection).toEqual({ frame: about.id, nodeId: "title" });
    expect(editor.view).toEqual(ABOUT_IN_VIEW);
  });

  it("leaves the prototype, and moves once the canvas is on screen", async () => {
    useEditor.getState().setWorkspace("prototype");
    // The prototype has no canvas on screen.
    hideCanvas();
    await reveal({ page: home.id });
    expect(useEditor.getState().workspace).toBe("design");
    expect(useEditor.getState().selectedPage).toBe(home.id);
    expect(useEditor.getState().view).toEqual(START);
    hideCanvas = measureViewportWith(() => VIEWPORT);
    expect(useEditor.getState().view).toEqual(HOME_IN_VIEW);
  });

  it("waits for a node beside the pages until its document is read", async () => {
    await reveal({ frame: "node:n1", nodeId: "n1" });
    expect(useEditor.getState().selection).toEqual({
      frame: "node:n1",
      nodeId: "n1",
    });
    expect(useEditor.getState().view).toEqual(START);
    useDocuments.setState({ docs: { [CANVAS]: canvasDoc } });
    expect(useEditor.getState().view).toEqual(NODE_IN_VIEW);
  });

  it("gives up waiting for what another reveal took over", async () => {
    await reveal({ frame: "node:n1", nodeId: "n1" });
    await reveal({ page: home.id });
    expect(useEditor.getState().view).toEqual(HOME_IN_VIEW);
    useEditor.setState({ view: START });
    useDocuments.setState({ docs: { [CANVAS]: canvasDoc } });
    expect(useEditor.getState().view).toEqual(START);
  });
});

describe("showScope", () => {
  it("goes to a thread's page on another canvas", async () => {
    await showScope(thread({ file: about.file, name: "about" }));
    const editor = useEditor.getState();
    expect(editor.canvas).toBe("other");
    expect(editor.selectedPage).toBe(about.id);
    expect(editor.view).toEqual(ABOUT_IN_VIEW);
  });

  it("goes to a thread's node on a page of another canvas", async () => {
    await showScope(
      thread({ file: about.file, name: "Title", nodeId: "title" })
    );
    const editor = useEditor.getState();
    expect(editor.canvas).toBe("other");
    expect(editor.selection).toEqual({ frame: about.id, nodeId: "title" });
    expect(editor.view).toEqual(ABOUT_IN_VIEW);
  });

  it("goes to a thread's node beside the pages of another canvas", async () => {
    useProject.setState({
      settings: { designsDir: "designs" } as ReturnType<
        typeof useProject.getState
      >["settings"],
    });
    fakeApi.respond("documents.list", ({ canvas }) =>
      canvas === "other" ? [otherCanvasDoc] : []
    );
    await showScope(
      thread({ file: "designs/other/canvas.json", name: "Card", nodeId: "n3" })
    );
    const editor = useEditor.getState();
    expect(editor.canvas).toBe("other");
    expect(editor.selection).toEqual({ frame: "node:n2", nodeId: "n3" });
  });
});
