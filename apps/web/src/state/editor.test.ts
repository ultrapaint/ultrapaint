import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { CanvasLayout, Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useDocuments } from "./documents.ts";
import { type Selection, useEditor } from "./editor.ts";
import { useProject } from "./project.ts";

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

describe("selection", () => {
  const a: Selection = { frame: home.id, nodeId: "a" };
  const b: Selection = { frame: home.id, nodeId: "b" };
  const c: Selection = { frame: home.id, nodeId: "c" };
  const elsewhere: Selection = { frame: pricing.id, nodeId: "p" };

  it("toggleSelected adds, takes out and hands the primary on", () => {
    const { select, toggleSelected } = useEditor.getState();
    select(a);
    toggleSelected(b);
    expect(useEditor.getState()).toMatchObject({ also: [a], selection: b });
    toggleSelected(c);
    expect(useEditor.getState()).toMatchObject({ also: [a, b], selection: c });
    // Taking out one of the others leaves the primary.
    toggleSelected(a);
    expect(useEditor.getState()).toMatchObject({ also: [b], selection: c });
    // Taking out the primary makes the last one added the primary.
    toggleSelected(c);
    expect(useEditor.getState()).toMatchObject({ also: [], selection: b });
  });

  it("toggleSelected in another frame starts over there", () => {
    const { select, toggleSelected } = useEditor.getState();
    select(a);
    toggleSelected(b);
    toggleSelected(elsewhere);
    expect(useEditor.getState()).toMatchObject({
      also: [],
      selection: elsewhere,
    });
  });

  it("selectMany keeps only the first one's frame, and empties on nothing", () => {
    const { selectMany } = useEditor.getState();
    selectMany([a, elsewhere, b]);
    expect(useEditor.getState()).toMatchObject({ also: [b], selection: a });
    selectMany([]);
    expect(useEditor.getState()).toMatchObject({ also: [], selection: null });
  });

  it("selects nothing in the prototype", () => {
    useEditor.setState({ workspace: "prototype" });
    useEditor.getState().select(a);
    useEditor.getState().selectMany([a, b]);
    expect(useEditor.getState().selection).toBeNull();
  });
});

describe("setWorkspace", () => {
  it("puts the selection aside in the prototype and finds it again without what was deleted", () => {
    useDocuments.setState({
      canvas: "main",
      docs: { [home.id]: doc(home.id, ["a", "b"]) },
    });
    useEditor.setState({ leftTab: "layers", workspace: "design" });
    useEditor.getState().select({ frame: home.id, nodeId: "a" });
    useEditor.getState().toggleSelected({ frame: home.id, nodeId: "b" });

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
