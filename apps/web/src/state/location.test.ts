import "../testing/fake-browser.ts";
import type { CanvasLayout, Page } from "@ultrapaint/contracts/pages";
import { matchRoute, pagesInVariant } from "@ultrapaint/shared/route";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { fakeBrowser } from "../testing/fake-browser.ts";
import { pagesOfCanvas, useEditor } from "./editor.ts";
import {
  followHistory,
  goTo,
  landingOf,
  openStartCanvas,
  pagesChanged,
} from "./location.ts";
import { computeFrames, setFrame } from "./page-layout.ts";
import { useProject } from "./project.ts";
import { select, selectPage } from "./selection.ts";
import { readUrl } from "./url.ts";

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
const boldDraft = page("draft@bold.page.json", { variant: "bold" });
const about = page("about.page.json", { route: "/about" }, "other");
const mainPages = [home, pricing, boldPricing, draft, boldDraft];

const layoutOf = (frames: CanvasLayout["frames"] = {}): CanvasLayout => ({
  frames,
  version: 1,
});

/** Lets every answer on its way land: a canvas's layout, a step of the history. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const at = () => {
  const { activePage, canvas, route, variant } = useEditor.getState();
  return { activePage, canvas, route, variant };
};

/**
 * The invariant, as what breaks it: the page that is is the one serving the route in the variant
 * (or, at no URL, the page shown), and the URL says the same.
 */
const outOfStep = (): string[] => {
  const { activePage, canvas, route, variant } = at();
  const out: string[] = [];
  if (route !== null) {
    const served =
      matchRoute(pagesInVariant(pagesOfCanvas(canvas), variant), route)?.entry
        .id ?? null;
    if (served !== activePage) {
      out.push(`${served} serves ${route}, not ${activePage}`);
    }
  }
  const url = readUrl();
  const said = {
    canvas: canvas === "" ? null : canvas,
    page: route === null ? activePage : null,
    route,
    variant,
  };
  for (const [key, value] of Object.entries(said)) {
    if (url[key as keyof typeof said] !== value) {
      out.push(
        `the URL's ${key} is ${url[key as keyof typeof said]}, not ${value}`
      );
    }
  }
  return out;
};

const initial = useEditor.getState();
let stopFollowing: () => void = () => undefined;

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("canvas.get", () => layoutOf());
  fakeApi.respond("documents.list", () => []);
  useProject.setState({
    canvases: [
      { home: "/", id: "main", name: "Main", variants: ["bold"] },
      { home: "/about", id: "other", name: "Other", variants: [] },
    ],
    pages: [...mainPages, about],
  });
  useEditor.setState(initial, true);
  localStorage.clear();
  fakeBrowser.visit("/");
  stopFollowing = followHistory();
});

afterEach(() => {
  vi.useRealTimers();
  stopFollowing();
});

/** Starts on the canvas main, at its home, with the history holding that one entry. */
const startOnMain = async () => {
  await goTo({ canvas: "main" });
  fakeBrowser.visit(`${window.location.pathname}${window.location.search}`);
};

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

describe("openStartCanvas", () => {
  it("opens the canvas and the place the URL names", async () => {
    fakeBrowser.visit("/?canvas=main&route=/pricing&variant=bold");
    expect(openStartCanvas()).toBe(true);
    await settle();
    expect(at()).toEqual({
      activePage: boldPricing.id,
      canvas: "main",
      route: "/pricing",
      variant: "bold",
    });
    expect(localStorage.getItem("ultrapaint:canvas")).toBe("main");
    expect(outOfStep()).toEqual([]);
  });

  it("opens on a page without a URL the URL names", async () => {
    fakeBrowser.visit(`/?canvas=main&page=${draft.id}`);
    openStartCanvas();
    await settle();
    expect(at()).toMatchObject({ activePage: draft.id, route: null });
    expect(outOfStep()).toEqual([]);
  });

  it("opens the canvas opened last when the URL names none, on its home", async () => {
    localStorage.setItem("ultrapaint:canvas", "other");
    openStartCanvas();
    await settle();
    expect(at()).toEqual({
      activePage: about.id,
      canvas: "other",
      route: "/about",
      variant: null,
    });
    expect(outOfStep()).toEqual([]);
  });

  it("opens the first canvas when neither names one", async () => {
    openStartCanvas();
    await settle();
    expect(at()).toMatchObject({ activePage: home.id, canvas: "main" });
    expect(window.location.search).toBe("?canvas=main");
    expect(outOfStep()).toEqual([]);
  });

  it("passes over a canvas the URL names that is not there, and its place", async () => {
    localStorage.setItem("ultrapaint:canvas", "other");
    fakeBrowser.visit("/?canvas=gone&route=/pricing");
    openStartCanvas();
    await settle();
    expect(at()).toMatchObject({ canvas: "other", route: "/about" });
    expect(outOfStep()).toEqual([]);
  });

  it("lands where the canvas opens for a page or a URL that is not there", async () => {
    fakeBrowser.visit("/?canvas=main&page=gone.page.json");
    openStartCanvas();
    await settle();
    expect(at()).toMatchObject({ activePage: home.id, route: "/" });
    expect(outOfStep()).toEqual([]);

    useEditor.setState({ canvas: null });
    fakeBrowser.visit("/?canvas=main&route=/gone&variant=nope");
    openStartCanvas();
    await settle();
    expect(at()).toMatchObject({
      activePage: home.id,
      route: "/",
      variant: null,
    });
    expect(outOfStep()).toEqual([]);
  });

  it("reads a URL without a canvas as the designs directory's own", async () => {
    const root = page("index.page.json", { route: "/" }, "");
    const rootPricing = page("pricing.page.json", { route: "/pricing" }, "");
    useProject.setState({
      canvases: [
        { home: "/", id: "", name: "Designs", variants: [] },
        { home: "/about", id: "other", name: "Other", variants: [] },
      ],
      pages: [root, rootPricing, about],
    });
    localStorage.setItem("ultrapaint:canvas", "other");
    fakeBrowser.visit("/?route=/pricing");
    openStartCanvas();
    await settle();
    expect(at()).toMatchObject({ canvas: "", route: "/pricing" });
    expect(outOfStep()).toEqual([]);
  });

  it("opens nothing while there are no canvases, or once one is open", async () => {
    useProject.setState({ canvases: [], pages: [] });
    expect(openStartCanvas()).toBe(false);
    useProject.setState({
      canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
      pages: mainPages,
    });
    await goTo({ canvas: "main" });
    expect(openStartCanvas()).toBe(false);
    expect(outOfStep()).toEqual([]);
  });
});

describe("goTo", () => {
  beforeEach(startOnMain);

  it("goes to a URL as an entry of the history, and lets the selection go", () => {
    select({ frame: home.id, nodeId: "a" });
    goTo({ route: "/pricing" });
    expect(at()).toMatchObject({ activePage: pricing.id, route: "/pricing" });
    expect(useEditor.getState().selection).toBeNull();
    expect(fakeBrowser.history().entries).toHaveLength(2);
    expect(outOfStep()).toEqual([]);
  });

  it("pushes a page opened, and replaces with push false", () => {
    goTo({ page: draft.id });
    expect(at()).toMatchObject({ activePage: draft.id, route: null });
    expect(fakeBrowser.history().entries).toHaveLength(2);
    goTo({ page: pricing.id }, { push: false });
    expect(at()).toMatchObject({ activePage: pricing.id, route: "/pricing" });
    expect(fakeBrowser.history().entries).toEqual([
      "/?canvas=main",
      "/?canvas=main&route=%2Fpricing",
    ]);
    expect(outOfStep()).toEqual([]);
  });

  it("goes to a page with a URL at it, in its variant", () => {
    goTo({ page: boldPricing.id });
    expect(at()).toMatchObject({
      activePage: boldPricing.id,
      route: "/pricing",
      variant: "bold",
    });
    expect(outOfStep()).toEqual([]);
  });

  it("stays on a page already shown at its URL", () => {
    goTo({ route: "/pricing" });
    select({ frame: pricing.id, nodeId: "a" });
    goTo({ page: pricing.id });
    expect(useEditor.getState().selection).not.toBeNull();
    expect(fakeBrowser.history().entries).toHaveLength(2);
    expect(outOfStep()).toEqual([]);
  });

  it("draws the same place in a variant, keeping the selection", () => {
    goTo({ route: "/pricing" });
    select({ frame: pricing.id, nodeId: "a" });
    goTo({ variant: "bold" });
    expect(at()).toMatchObject({ activePage: boldPricing.id, variant: "bold" });
    expect(useEditor.getState().selection).not.toBeNull();
    expect(outOfStep()).toEqual([]);
    // On a page without a URL: the variant's drawing of it.
    goTo({ page: draft.id });
    goTo({ variant: "bold" });
    expect(at()).toMatchObject({ activePage: boldDraft.id, route: null });
    expect(fakeBrowser.history().entries).toHaveLength(5);
    expect(outOfStep()).toEqual([]);
  });

  it("does nothing for a page that is not there", () => {
    goTo({ page: "gone.page.json" });
    expect(at()).toMatchObject({ activePage: home.id, route: "/" });
    expect(outOfStep()).toEqual([]);
  });

  it("opens a canvas in place of the entry, remembered for the next start", async () => {
    await goTo({ canvas: "other" });
    expect(at()).toMatchObject({ activePage: about.id, canvas: "other" });
    expect(fakeBrowser.history().entries).toEqual([
      "/?canvas=other&route=%2Fabout",
    ]);
    expect(localStorage.getItem("ultrapaint:canvas")).toBe("other");
    expect(outOfStep()).toEqual([]);
  });

  it("opens the last canvas asked for, whichever layout arrives last", async () => {
    let answerMain: (layout: CanvasLayout) => void = () => undefined;
    fakeApi.respond("canvas.get", ({ canvas }: { canvas: string }) =>
      canvas === "main"
        ? new Promise<CanvasLayout>((resolve) => {
            answerMain = resolve;
          })
        : layoutOf()
    );
    const first = goTo({ canvas: "main" });
    const second = goTo({ canvas: "other" });
    await second;
    answerMain(layoutOf());
    await first;
    expect(at()).toMatchObject({ activePage: about.id, canvas: "other" });
    expect(outOfStep()).toEqual([]);
  });

  it("saves a move to the canvas it was made on, another canvas opened right after", async () => {
    vi.useFakeTimers();
    useEditor.setState({ frames: computeFrames([home], layoutOf()) });
    const moved = {
      height: 900,
      preset: "desktop",
      width: 1440,
      x: 300,
      y: 40,
    } as const;
    setFrame(home.id, moved);
    await goTo({ canvas: "other" });
    expect(fakeApi.calls.filter((c) => c.method === "canvas.set")).toEqual([
      {
        input: { canvas: "main", frames: { [home.path]: moved } },
        method: "canvas.set",
      },
    ]);
    // Nothing is saved later onto the canvas opened.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeApi.calls.filter((c) => c.method === "canvas.set")).toHaveLength(
      1
    );
    expect(outOfStep()).toEqual([]);
  });
});

describe("back and forward", () => {
  beforeEach(startOnMain);

  it("restore the page, the URL and the variant of each entry", async () => {
    goTo({ route: "/pricing", variant: "bold" });
    goTo({ page: draft.id });
    select({ frame: draft.id, nodeId: "a" });

    window.history.back();
    await settle();
    expect(at()).toMatchObject({
      activePage: boldPricing.id,
      route: "/pricing",
      variant: "bold",
    });
    expect(useEditor.getState().selection).toBeNull();
    expect(outOfStep()).toEqual([]);

    window.history.back();
    await settle();
    expect(at()).toMatchObject({
      activePage: home.id,
      route: "/",
      variant: null,
    });
    expect(outOfStep()).toEqual([]);

    window.history.forward();
    window.history.forward();
    await settle();
    expect(at()).toMatchObject({
      activePage: draft.id,
      route: null,
      variant: null,
    });
    // Going back wrote no entry of its own.
    expect(fakeBrowser.history().entries).toHaveLength(3);
    expect(outOfStep()).toEqual([]);
  });

  it("open the canvas of an entry", async () => {
    goTo({ route: "/pricing", variant: "bold" });
    goTo({ route: "/" });
    await goTo({ canvas: "other" });

    window.history.back();
    await settle();
    expect(at()).toEqual({
      activePage: boldPricing.id,
      canvas: "main",
      route: "/pricing",
      variant: "bold",
    });
    expect(outOfStep()).toEqual([]);

    window.history.forward();
    await settle();
    expect(at()).toMatchObject({ activePage: about.id, canvas: "other" });
    expect(outOfStep()).toEqual([]);
  });

  it("keep the workspace", async () => {
    goTo({ route: "/pricing" });
    useEditor.getState().setWorkspace("prototype");
    window.history.back();
    await settle();
    expect(readUrl().mode).toBe("prototype");
    expect(outOfStep()).toEqual([]);
  });
});

describe("followFrame", () => {
  beforeEach(startOnMain);

  it("goes to the URL and variant of a page selected in, in place of the entry", () => {
    select({ frame: boldPricing.id, nodeId: "x" });
    expect(at()).toMatchObject({
      activePage: boldPricing.id,
      route: "/pricing",
      variant: "bold",
    });
    expect(useEditor.getState().selection).toEqual({
      frame: boldPricing.id,
      nodeId: "x",
    });
    expect(fakeBrowser.history().entries).toHaveLength(1);
    expect(outOfStep()).toEqual([]);
  });

  it("goes to a page without a URL as itself", () => {
    selectPage(draft.id);
    expect(at()).toMatchObject({ activePage: draft.id, route: null });
    expect(useEditor.getState().selectedPage).toBe(draft.id);
    expect(outOfStep()).toEqual([]);
  });

  it("goes to the page of a view selected in", () => {
    select({ frame: `${pricing.id}#w390`, nodeId: "x" });
    expect(at()).toMatchObject({ activePage: pricing.id, route: "/pricing" });
    expect(outOfStep()).toEqual([]);
  });

  it("stays where it is for a node on the canvas", () => {
    goTo({ route: "/pricing" });
    select({ frame: "node:n1", nodeId: "n1" });
    expect(at()).toMatchObject({ activePage: pricing.id, route: "/pricing" });
    expect(outOfStep()).toEqual([]);
  });
});

describe("pagesChanged", () => {
  beforeEach(startOnMain);

  it("gives a canvas deleted while open way to the first one left", async () => {
    await goTo({ canvas: "other" });
    useProject.setState({
      canvases: [{ home: "/", id: "main", name: "Main", variants: ["bold"] }],
      pages: mainPages,
    });
    pagesChanged();
    await settle();
    expect(at()).toMatchObject({ activePage: home.id, canvas: "main" });
    expect(outOfStep()).toEqual([]);
  });

  it("opens the canvas again where it is when a page comes or goes", async () => {
    goTo({ route: "/pricing", variant: "bold" });
    const added = page("faq.page.json", { route: "/faq" });
    useProject.setState({ pages: [...mainPages, added, about] });
    fakeApi.calls.length = 0;
    pagesChanged();
    await settle();
    expect(fakeApi.calls.map((c) => c.method)).toContain("canvas.get");
    expect(useEditor.getState().frames[added.id]).toBeDefined();
    expect(at()).toMatchObject({
      activePage: boldPricing.id,
      variant: "bold",
    });
    expect(outOfStep()).toEqual([]);
  });

  it("leaves a canvas whose pages have views as it is", async () => {
    fakeApi.respond("canvas.get", () =>
      layoutOf({
        [home.path]: {
          height: 900,
          preset: "desktop",
          views: [{ height: 800, id: "w390", width: 390, x: 1500, y: 0 }],
          width: 1440,
          x: 0,
          y: 0,
        },
      })
    );
    await goTo({ canvas: "main" });
    fakeApi.calls.length = 0;
    pagesChanged();
    await settle();
    expect(fakeApi.calls).toEqual([]);
    expect(outOfStep()).toEqual([]);
  });

  it("goes with a page shown without a URL to the URL it is given", () => {
    goTo({ page: draft.id });
    useProject.setState({
      pages: [
        home,
        pricing,
        boldPricing,
        { ...draft, route: "/draft" },
        boldDraft,
        about,
      ],
    });
    pagesChanged();
    expect(at()).toMatchObject({ activePage: draft.id, route: "/draft" });
    expect(fakeBrowser.history().entries).toHaveLength(2);
    expect(outOfStep()).toEqual([]);
  });

  it("gives a page shown that is gone way to where the canvas opens", async () => {
    goTo({ page: draft.id });
    useProject.setState({
      pages: [home, pricing, boldPricing, boldDraft, about],
    });
    pagesChanged();
    await settle();
    expect(at()).toMatchObject({ activePage: home.id, route: "/" });
    expect(outOfStep()).toEqual([]);
  });

  it("follows the page serving the URL in the list", () => {
    goTo({ route: "/pricing" });
    // Another page serves the URL now, the frames unchanged.
    useProject.setState({
      pages: [
        home,
        { ...pricing, route: "/prices" },
        boldPricing,
        { ...draft, route: "/pricing" },
        boldDraft,
        about,
      ],
    });
    pagesChanged();
    expect(at()).toMatchObject({ activePage: draft.id, route: "/pricing" });
    expect(outOfStep()).toEqual([]);
  });
});
