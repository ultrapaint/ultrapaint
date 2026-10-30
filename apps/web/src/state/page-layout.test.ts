import "../testing/fake-browser.ts";
import type { CanvasLayout, Page } from "@ultrapaint/contracts/pages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { undoOrRedo } from "../lib/shortcuts.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useEditor } from "./editor.ts";
import { viewFrameOf } from "./frame-ref.ts";
import {
  addView,
  applyLayout,
  computeFrames,
  layoutSaved,
  removeView,
  setFrame,
  showFrame,
} from "./page-layout.ts";
import { useProject } from "./project.ts";
import { followServer } from "./server-data.ts";

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

const initial = useEditor.getState();

/** Lets what the answers given set off run its course. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    expect(frames[home.id]).toMatchObject({ preset: "desktop", x: 1480, y: 0 });
    expect(frames[draft.id]).toMatchObject({ x: 1480 + 1440 + 80 });
  });

  it("draws a page's views as frames of their own, and lines the others past them", () => {
    const frames = computeFrames(
      [home, pricing],
      layoutOf({
        [pricing.path]: {
          height: 500,
          preset: "custom",
          views: [{ height: 844, id: "w390", width: 390, x: 480, y: 0 }],
          width: 400,
          x: 1000,
          y: 50,
        },
      })
    );
    expect(frames[viewFrameOf(pricing.id, "w390")]).toEqual({
      height: 844,
      preset: "custom",
      width: 390,
      x: 1480,
      y: 50,
    });
    expect(frames[home.id]).toMatchObject({ x: 1480 + 390 + 80 });
  });
});

describe("a page's views", () => {
  const desktop = (x: number, y = 0) => ({
    height: 900,
    preset: "desktop" as const,
    width: 1440,
    x,
    y,
  });
  const open = (frames: CanvasLayout["frames"]) =>
    useEditor.setState({
      frames: computeFrames([home, pricing], layoutOf(frames)),
    });
  const saved = async () => {
    await layoutSaved();
    const call = fakeApi.calls.findLast((c) => c.method === "canvas.set");
    return (call?.input as { frames: CanvasLayout["frames"] } | undefined)
      ?.frames;
  };

  it("addView puts a view right of the page and its views, named by its width", async () => {
    open({ [home.path]: desktop(0), [pricing.path]: desktop(0, 2000) });
    const first = addView(home.id, 390);
    const second = addView(home.id, 390, 600);
    expect([first, second]).toEqual([
      viewFrameOf(home.id, "w390"),
      viewFrameOf(home.id, "w390-2"),
    ]);
    expect((await saved())?.[home.path]?.views).toEqual([
      { height: 900, id: "w390", width: 390, x: 1520, y: 0 },
      { height: 600, id: "w390-2", width: 390, x: 1520 + 390 + 80, y: 0 },
    ]);
  });

  it("addView puts a view under the page when another page is to its right", () => {
    open({ [home.path]: desktop(0), [pricing.path]: desktop(1520) });
    addView(home.id, 768, 1024);
    expect(useEditor.getState().frames[viewFrameOf(home.id, "w768")]).toEqual({
      height: 1024,
      preset: "custom",
      width: 768,
      x: 0,
      y: 980,
    });
  });

  it("addView on a frame the canvas does not have adds nothing", () => {
    open({});
    expect(addView("nowhere.page.json", 390)).toBeNull();
  });

  it("removeView takes the view out, and a selection in it to the page's frame", async () => {
    open({
      [home.path]: {
        ...desktop(0),
        views: [{ height: 844, id: "w390", width: 390, x: 1520, y: 0 }],
      },
    });
    const view = viewFrameOf(home.id, "w390");
    useEditor.getState().selectMany([
      { frame: view, nodeId: "a" },
      { frame: view, nodeId: "b" },
    ]);
    removeView(view);
    const s = useEditor.getState();
    expect(s.frames[view]).toBeUndefined();
    expect(s.selection).toEqual({ frame: home.id, nodeId: "a" });
    expect(s.also).toEqual([{ frame: home.id, nodeId: "b" }]);
    expect((await saved())?.[home.path]).not.toHaveProperty("views");
  });
});

describe("applyLayout", () => {
  const moved = layoutOf({
    [home.path]: { height: 900, preset: "desktop", width: 1440, x: 300, y: 0 },
  });

  it("draws the open canvas's frames from a layout the server sent", () => {
    applyLayout("main", moved);
    const s = useEditor.getState();
    expect(s.layout).toBe(moved);
    expect(s.frames[home.id]).toMatchObject({ x: 300 });
    // Pricing, saved nowhere, is the first page past Home.
    expect(s.frames[pricing.id]).toMatchObject({ x: 300 + 1440 + 80 });
  });

  it("leaves the frames alone for another canvas", () => {
    applyLayout("other", moved);
    expect(useEditor.getState().frames).toEqual({});
  });
});

describe("saving the layout", () => {
  const desktop = (x: number, y = 0) => ({
    height: 900,
    preset: "desktop" as const,
    width: 1440,
    x,
    y,
  });
  // Every page of the canvas has its frame saved.
  const saved = layoutOf({
    [home.path]: desktop(0),
    [pricing.path]: desktop(0, 2000),
    [boldPricing.path]: desktop(0, 4000),
    [draft.path]: desktop(0, 6000),
  });
  const pushed = (frames: CanvasLayout["frames"]) =>
    fakeApi.emit("canvas", {
      canvas: "main",
      layout: layoutOf({ ...saved.frames, ...frames }),
    });
  const sets = () =>
    fakeApi.calls.filter((c) => c.method === "canvas.set").map((c) => c.input);
  const frameOf = (id: string) => useEditor.getState().frames[id];
  /** The answers to the saves sent, in order, held until the test gives them. */
  let answers: (() => void)[] = [];
  let stop: () => void = () => undefined;

  beforeEach(async () => {
    answers = [];
    fakeApi.respond(
      "canvas.set",
      () =>
        new Promise<void>((resolve) => {
          answers.push(resolve);
        })
    );
    stop = followServer({ report: () => undefined });
    await settle();
    applyLayout("main", saved);
  });

  // A save left in flight would keep its page in the next test.
  afterEach(async () => {
    stop();
    vi.useRealTimers();
    for (const answer of answers) {
      answer();
    }
    await layoutSaved();
  });

  it("saves a frame at once, sending only its page, as it was set", async () => {
    vi.useFakeTimers();
    setFrame(home.id, desktop(50));
    expect(sets()).toEqual([
      { canvas: "main", frames: { [home.path]: desktop(50) } },
    ]);
    // A gesture showing it elsewhere since saves nothing.
    showFrame(home.id, { ...desktop(50), x: 73.4 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sets()).toHaveLength(1);
  });

  it("sends the pages drawn where no frame is saved, so they stay where they are drawn", () => {
    applyLayout("main", layoutOf({ [home.path]: desktop(0) }));
    const drawn = useEditor.getState().frames;
    setFrame(home.id, desktop(5000));
    expect(sets()).toEqual([
      {
        canvas: "main",
        frames: {
          [boldPricing.path]: drawn[boldPricing.id],
          [draft.path]: drawn[draft.id],
          [home.path]: desktop(5000),
          [pricing.path]: drawn[pricing.id],
        },
      },
    ]);
  });

  it("follows a push for a page while another page's save is in flight", () => {
    setFrame(home.id, desktop(50));
    pushed({ [pricing.path]: desktop(3000, 2000) });
    expect(frameOf(pricing.id)).toMatchObject({ x: 3000 });
    expect(frameOf(home.id)).toMatchObject({ x: 50 });
    expect(useEditor.getState().layout.frames[home.path]).toEqual(desktop(50));
  });

  it("keeps a page where it was put while its save is in flight, and follows it once answered", async () => {
    setFrame(home.id, desktop(50));
    // Read before the save landed: the old place.
    pushed({});
    expect(frameOf(home.id)).toMatchObject({ x: 50 });
    answers[0]?.();
    await layoutSaved();
    expect(frameOf(home.id)).toMatchObject({ x: 50 });
    // An agent moved it since.
    pushed({ [home.path]: desktop(900) });
    expect(frameOf(home.id)).toMatchObject({ x: 900 });
  });

  it("keeps a page while a second save of it is in flight, the first answered", async () => {
    setFrame(home.id, desktop(50));
    setFrame(home.id, desktop(70));
    answers[0]?.();
    await settle();
    pushed({ [home.path]: desktop(50) });
    expect(frameOf(home.id)).toMatchObject({ x: 70 });
    answers[1]?.();
    await layoutSaved();
  });

  it("undoes once the saves in flight are answered", async () => {
    fakeApi.respond("edit.undo", () => null);
    setFrame(home.id, desktop(50));
    const undone = undoOrRedo(false);
    await settle();
    expect(fakeApi.calls.map((c) => c.method)).not.toContain("edit.undo");
    answers[0]?.();
    await undone;
    expect(fakeApi.calls.map((c) => c.method).at(-1)).toBe("edit.undo");
  });
});
