// @vitest-environment happy-dom
/**
 * A text edited in place, in a page's frame drawn by the preview core under the page's select
 * layer (`SelectLayer`, which says how long an edit lasts): started by a double-click, it ends
 * when the selection leaves its text, and leaves no highlight of the browser's on its words.
 */
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { NODE_ATTRIBUTE } from "@ultrapaint/preview-core/preview";
import { BODY_ATTRIBUTE } from "@ultrapaint/preview-core/styles";
import { scriptedPreview } from "@ultrapaint/preview-core/testing";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { surfaceNow } from "../state/surface.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { frameOf } from "./editor-frame.ts";
import { SelectLayer } from "./frame.tsx";
import { useFramePointer } from "./use-frame-pointer.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const core = scriptedPreview();
const titleNode = {
  id: "title",
  role: "heading",
  text: "IT Admin",
  type: "text",
} as DesignNode;
const root = {
  children: [titleNode],
  id: "home-root",
  type: "page",
} as DesignNode;
const homeDoc: DocumentState = { doc: HOME, hash: `${HOME}@0`, root };

/** The page's select layer, as `Frame` has it. */
const Page = () => {
  const pointer = useFramePointer({
    canvas: "main",
    frame: { x: 0, y: 0 },
    frameId: HOME,
    root,
  });
  return (
    <SelectLayer
      frameId={HOME}
      name="home"
      onClick={pointer.onSelectClick}
      onContextMenu={pointer.onContextMenu}
      onDoubleClick={pointer.onDoubleClick}
      onGone={pointer.onSelectLayerGone}
      onPointerDown={pointer.onPointerDown}
      onPointerLeave={pointer.onPointerLeave}
      onPointerMove={pointer.onPointerMove}
    />
  );
};

let ground: HTMLDivElement;
let mounted: Root;
let title: HTMLElement;
let committed: ReturnType<typeof vi.fn<(nodeId: string, text: string) => void>>;
let stopListening: () => void;

/** Whether the title is being edited: the browser writes to it. */
const isEdited = () => title.hasAttribute("contenteditable");

/** The browser's highlight: what it has selected, as its text. */
const highlighted = () => getSelection()?.toString() ?? "";

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
    pages: [
      {
        canvas: "main",
        file: `designs/${HOME}`,
        id: HOME,
        name: "home",
        path: HOME,
      },
    ],
  });
  useDocuments.setState({ docs: { [HOME]: homeDoc } });
  useEditor.setState({
    also: [],
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    hover: null,
    mode: "select",
    selection: null,
    spacePan: false,
    view: { x: 0, y: 0, zoom: 1 },
  });
  const holder = document.createElement("div");
  document.body.append(holder);
  const { host } = frameOf(HOME).open({
    canvas: "main",
    holder,
    preview: core.preview,
  });
  title = document.createElement("h1");
  title.setAttribute(NODE_ATTRIBUTE, "title");
  title.textContent = "IT Admin";
  host.shadowRoot?.querySelector(`[${BODY_ATTRIBUTE}]`)?.append(title);
  // Where the double-click lands: the browser lays the page out, happy-dom does not.
  vi.spyOn(frameOf(HOME), "hitTest").mockReturnValue(["home-root", "title"]);
  committed = vi.fn<(nodeId: string, text: string) => void>();
  stopListening = frameOf(HOME).listen({ textCommit: committed });
  ground = document.createElement("div");
  document.body.append(ground);
  mounted = createRoot(ground);
  act(() => mounted.render(<Page />));
  const layer = ground.querySelector('button[aria-label="Select in home"]');
  act(() => {
    layer?.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: 20, clientY: 20 })
    );
  });
});

afterEach(() => {
  act(() => mounted.unmount());
  stopListening();
  vi.restoreAllMocks();
  frameOf(HOME).drop();
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("a text double-clicked on a page", () => {
  it("is selected and edited, its words highlighted", () => {
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "title",
    });
    expect(isEdited()).toBe(true);
    expect(highlighted()).toBe("IT Admin");
  });

  it("stays edited while it stays selected, whatever else changes", () => {
    act(() => useEditor.setState({ hover: { frame: HOME, nodeId: "title" } }));
    expect(isEdited()).toBe(true);
    expect(highlighted()).toBe("IT Admin");
  });

  it("is let go by a press on the canvas ground: what was typed is kept, and no highlight is left", () => {
    title.textContent = "IT Support";
    act(() => surfaceNow().onGroundPress());
    expect(useEditor.getState().selection).toBeNull();
    expect(isEdited()).toBe(false);
    expect(committed).toHaveBeenCalledWith("title", "IT Support");
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("is let go when another element is selected", () => {
    act(() =>
      useEditor.setState({ selection: { frame: HOME, nodeId: "home-root" } })
    );
    expect(isEdited()).toBe(false);
    expect(getSelection()?.rangeCount).toBe(0);
  });

  it("is let go when another tool is taken", () => {
    act(() => useEditor.setState({ mode: "comment" }));
    expect(isEdited()).toBe(false);
    expect(getSelection()?.rangeCount).toBe(0);
  });
});
