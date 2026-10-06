import "../testing/fake-browser.ts";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { CanvasLayout, Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useDocuments } from "./documents.ts";
import {
  computeFrames,
  landingOf,
  nextView,
  type Selection,
  setViewSoon,
  useEditor,
} from "./editor.ts";
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

describe("landingOf", () => {
  const all = [home, pricing, boldPricing, draft];
  const base = [home, pricing, draft];

  it("opens on the page asked for when it serves no URL", () => {
    expect(landingOf(all, base, "/", draft.id)).toEqual({
      landing: null,
      shown: draft.id,
    });
  });

  it("opens on the page serving the route", () => {
    expect(landingOf(all, base, "/pricing", null)).toEqual({
      landing: "/pricing",
      shown: pricing.id,
    });
  });

  it("goes to the first URL served when the route has no page", () => {
    expect(landingOf(all, base, "/gone", null)).toEqual({
      landing: "/",
      shown: home.id,
    });
  });

  it("falls back to a page without a URL, then to nothing", () => {
    expect(landingOf([draft], [draft], "/", null)).toEqual({
      landing: null,
      shown: draft.id,
    });
    expect(landingOf([], [], "/x", null)).toEqual({
      landing: "/x",
      shown: null,
    });
  });
});

describe("computeFrames", () => {
  it("keeps saved frames and lines the others up to their right", () => {
    const frames = computeFrames(
      [home, pricing, draft],
      layoutOf({
        [pricing.path]: {
          height: 500,
          preset: "custom",
          width: 400,
          x: 1000,
          y: 50,
        },
      })
    );
    expect(frames[pricing.id]).toEqual({
      height: 500,
      preset: "custom",
      width: 400,
      x: 1000,
      y: 50,
    });
    // Past the right edge of the saved one, a gap apart, in page order.
    expect(frames[home.id]).toMatchObject({ preset: "desktop", x: 1520, y: 0 });
    expect(frames[draft.id]).toMatchObject({ x: 1520 + 1440 + 120 });
  });
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

describe("followFrame", () => {
  it("goes to the route and variant of a page selected in", () => {
    useEditor.setState({ activePage: home.id, route: "/", variant: null });
    useEditor.getState().select({ frame: boldPricing.id, nodeId: "x" });
    expect(useEditor.getState()).toMatchObject({
      activePage: boldPricing.id,
      route: "/pricing",
      variant: "bold",
    });
  });

  it("goes to a page without a URL as itself", () => {
    useEditor.getState().selectPage(draft.id);
    expect(useEditor.getState()).toMatchObject({
      activePage: draft.id,
      route: null,
      selectedPage: draft.id,
    });
  });

  it("stays where it is for a node on the canvas", () => {
    useEditor.setState({ activePage: pricing.id, route: "/pricing" });
    useEditor.getState().select({ frame: "node:n1", nodeId: "n1" });
    expect(useEditor.getState()).toMatchObject({
      activePage: pricing.id,
      route: "/pricing",
    });
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
      // The layers are Design's: the chat is shown instead.
      leftTab: "chat",
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

  it("keeps a panel every workspace offers", () => {
    useEditor.setState({ leftTab: "changes", workspace: "vibe" });
    useEditor.getState().setWorkspace("design");
    expect(useEditor.getState().leftTab).toBe("changes");
  });
});

describe("openCanvas", () => {
  it("opens the last canvas asked for, whichever layout arrives last", async () => {
    let answerMain: (layout: CanvasLayout) => void = () => undefined;
    fakeApi.respond("canvas.get", ({ canvas }: { canvas: string }) =>
      canvas === "main"
        ? new Promise<CanvasLayout>((resolve) => {
            answerMain = resolve;
          })
        : layoutOf()
    );
    const first = useEditor.getState().openCanvas("main");
    const second = useEditor.getState().openCanvas("other");
    await second;
    answerMain(layoutOf());
    await first;
    expect(useEditor.getState().canvas).toBe("other");
    expect(useEditor.getState().activePage).toBe(other.id);
  });

  it("saves a move still waiting to be saved to the canvas it was made on", async () => {
    vi.useFakeTimers();
    useEditor.setState({
      canvas: "main",
      frames: computeFrames([home], layoutOf()),
    });
    useEditor.getState().setFrame(home.id, {
      height: 900,
      preset: "desktop",
      width: 1440,
      x: 300,
      y: 40,
    });
    await useEditor.getState().openCanvas("other");
    const saves = fakeApi.calls.filter((c) => c.method === "canvas.set");
    expect(saves).toEqual([
      {
        input: {
          canvas: "main",
          frames: {
            [home.path]: {
              height: 900,
              preset: "desktop",
              width: 1440,
              x: 300,
              y: 40,
            },
          },
        },
        method: "canvas.set",
      },
    ]);
    // Nothing is left to save onto the canvas opened.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeApi.calls.filter((c) => c.method === "canvas.set")).toHaveLength(
      1
    );
  });
});

describe("setViewSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    useEditor.setState({ view: { x: 0, y: 0, zoom: 1 } });
  });

  it("takes every change of a frame in one, each going on from the last", () => {
    let changes = 0;
    const off = useEditor.subscribe(() => {
      changes += 1;
    });
    setViewSoon({ x: nextView().x - 10 });
    setViewSoon({ x: nextView().x - 10, zoom: 2 });
    expect(useEditor.getState().view).toEqual({ x: 0, y: 0, zoom: 1 });
    vi.advanceTimersByTime(16);
    off();
    expect(changes).toBe(1);
    expect(useEditor.getState().view).toEqual({ x: -20, y: 0, zoom: 2 });
  });

  it("gives way to a view set outright, which keeps what was waiting", () => {
    setViewSoon({ x: 50 });
    useEditor.getState().setView({ zoom: 3 });
    expect(useEditor.getState().view).toEqual({ x: 50, y: 0, zoom: 3 });
    vi.advanceTimersByTime(16);
    expect(useEditor.getState().view).toEqual({ x: 50, y: 0, zoom: 3 });
  });
});
