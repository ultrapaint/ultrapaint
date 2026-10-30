import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { CanvasLayout, Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { useProject } from "./project.ts";
import { select, toggleSelected } from "./selection.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const page = (
  id: string,
  extra: Partial<Page> = {},
  canvas = "main"
): Page => ({
  canvas,
  file: `designs/${id}`,
  id,
  name: id,
  path: id,
  ...extra,
});

const home = page("home.page.json", { route: "/" });
const pricing = page("pricing.page.json", { route: "/pricing" });
const boldPricing = page("pricing@bold.page.json", {
  route: "/pricing",
  variant: "bold",
});
const draft = page("draft.page.json");
const other = page("about.page.json", { route: "/about" }, "other");

const layoutOf = (frames: CanvasLayout["frames"] = {}): CanvasLayout => ({
  frames,
  version: 1,
});

const doc = (id: string, childIds: readonly string[]): DocumentState => ({
  doc: id,
  hash: id,
  root: {
    children: childIds.map((c) => ({
      id: c,
      role: "paragraph",
      text: c,
      type: "text",
    })),
    id: `${id}-root`,
    type: "page",
  },
});

const initial = useEditor.getState();

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("canvas.get", () => layoutOf());
  fakeApi.respond("documents.list", () => []);
  useProject.setState({
    canvases: [
      { home: "/", id: "main", name: "Main", variants: ["bold"] },
      { home: "/about", id: "other", name: "Other", variants: [] },
    ],
    pages: [home, pricing, boldPricing, draft, other],
  });
  useEditor.setState(initial, true);
  useEditor.setState({ canvas: "main" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("setWorkspace", () => {
  it("puts the selection aside in the prototype and finds it again without what was deleted", () => {
    useDocuments.setState({
      canvas: "main",
      docs: { [home.id]: doc(home.id, ["a", "b"]) },
    });
    useEditor.setState({ leftTab: "layers", workspace: "design" });
    select({ frame: home.id, nodeId: "a" });
    toggleSelected({ frame: home.id, nodeId: "b" });

    useEditor.getState().setWorkspace("prototype");
    expect(useEditor.getState()).toMatchObject({
      // The prototype shows its pages, not the rail's panels: the layers wait for the canvas.
      leftTab: "layers",
      mode: "interact",
      selection: null,
    });

    // "a" is deleted while the prototype is shown.
    useDocuments.setState({
      docs: { [home.id]: doc(home.id, ["b"]) },
    });
    useEditor.getState().setWorkspace("design");
    expect(useEditor.getState()).toMatchObject({
      also: [],
      mode: "select",
      selection: { frame: home.id, nodeId: "b" },
    });
  });

  it("keeps the canvas's left panel for its return", () => {
    useEditor.setState({ leftTab: "changes", workspace: "design" });
    useEditor.getState().setWorkspace("prototype");
    expect(useEditor.getState().leftTab).toBe("changes");
  });
});
