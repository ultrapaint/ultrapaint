// @vitest-environment happy-dom

import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type {
  VariationRound,
  VariationSets,
} from "@ultrapaint/contracts/variations";
import type {
  FrameRuntime,
  Preview,
  RenderRequest,
} from "@ultrapaint/preview-core/preview";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pressWindowKey } from "../lib/keymap.ts";
import { isMac } from "../lib/keys.ts";
import { Inspector } from "../panels/inspector.tsx";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { rightHasSubject } from "../state/panels.ts";
import { select } from "../state/selection.ts";
import { followServer } from "../state/server-data.ts";
import {
  closeVariations,
  drawnIn,
  loadVariations,
  openVariations,
  showPageVariation,
  showVariation,
  useVariations,
} from "../state/variations.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { keyEventOf } from "../testing/key-events.ts";
import { VariationPreviewChrome } from "./variation-preview.tsx";
import { VariationsBeside } from "./variations-beside.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** A preview whose frames keep what they are told to draw, by frame. */
const renders = vi.hoisted(
  () => [] as { frame: string; request: RenderRequest }[]
);
/** What each frame tells the editor, by frame: a size it drew at, as a frame reports one. */
const told = vi.hoisted(
  () =>
    new Map<
      string,
      { size?: (size: { height: number; width: number }) => void }
    >()
);
/** What a frame's hit test and measure answer, as a test sets them. */
const drawnAt = vi.hoisted(() => ({
  hits: [] as string[],
  rects: {} as Record<
    string,
    { height: number; width: number; x: number; y: number }
  >,
}));
/** How often the camera was fitted to the variations. */
const fits = vi.hoisted(() => ({ count: 0 }));
vi.mock("../state/camera.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/camera.ts")>()),
  zoomToBoxes: () => {
    fits.count += 1;
  },
}));
vi.mock("./preview-module.ts", () => {
  const preview = {
    fromFrame: () => false,
    mountFrame: (
      _host: unknown,
      options: {
        events: {
          size?: (size: { height: number; width: number }) => void;
        };
        frame: string;
      }
    ) =>
      ({
        editText: () => undefined,
        hitTest: () => drawnAt.hits,
        measure: (ids: readonly string[]) =>
          Object.fromEntries(
            ids.flatMap((id) =>
              drawnAt.rects[id] ? [[id, drawnAt.rects[id]]] : []
            )
          ),
        pageAt: () => [],
        render: (request: RenderRequest) => {
          renders.push({ frame: options.frame, request });
          told.set(options.frame, options.events);
        },
        screenshot: () => Promise.resolve(null),
        scrollIntoView: () => undefined,
        show: () => undefined,
        skeleton: () => undefined,
        unmount: () => undefined,
        watchRects: () => undefined,
      }) satisfies FrameRuntime,
    setLook: () => undefined,
  } satisfies Preview;
  return { usePreview: () => preview };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const PAGE = {
  height: 900,
  preset: "desktop" as const,
  width: 1440,
  x: 0,
  y: 0,
};

const heading = (text: string): DesignNode =>
  ({
    id: "title",
    level: 1,
    role: "heading",
    text,
    type: "text",
  }) as DesignNode;

const stateOf = (doc: string, root: DesignNode): DocumentState => ({
  doc,
  hash: `${doc}@0`,
  root,
});

const SETS: VariationSets = {
  title: {
    inUse: "original",
    variations: [
      { id: "original", name: "Original" },
      {
        id: "v2",
        name: "Editorial",
        tree: heading("Notes, now and then"),
        varied: "Tone of the copy",
      },
      { id: "v3", name: "Loud", tree: heading("GET THE NOTES") },
    ],
  },
};

let mounted: Root | null = null;
let stop: () => void = () => undefined;

const show = () => {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  const r = mounted;
  act(() =>
    r.render(
      <>
        <VariationsBeside />
        <VariationPreviewChrome frame={PAGE} frameId={HOME} />
      </>
    )
  );
};

/** A key pressed in the window, as the editor's keymap hears it. */
const press = (text: string) => {
  const e = new KeyboardEvent("keydown", {
    ...keyEventOf(text, isMac),
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    pressWindowKey(e);
  });
};

const click = (el: Element | null | undefined) => {
  act(() => (el as HTMLElement | null)?.click());
};

/** How the preview is outlined: dashed while it is not the one in use. */
const outline = () =>
  (document.querySelector("[data-variation-preview]") as HTMLElement).style
    .outlineStyle;

const controls = () =>
  document.querySelector("[data-variation-controls]")?.textContent ?? "";

const initialEditor = useEditor.getState();
const initialDocuments = useDocuments.getState();
const initialVariations = useVariations.getState();

beforeEach(async () => {
  fakeApi.reset();
  renders.length = 0;
  told.clear();
  fits.count = 0;
  useEditor.setState(initialEditor, true);
  useDocuments.setState(initialDocuments, true);
  useVariations.setState(initialVariations, true);
  useEditor.setState({
    canvas: "",
    frames: { [HOME]: PAGE },
    rects: { [HOME]: { title: { height: 40, width: 600, x: 32, y: 120 } } },
    workspace: "design",
  });
  useDocuments.setState({
    canvas: "",
    docs: {
      [HOME]: stateOf(HOME, {
        children: [heading("Drawing with constraints")],
        id: "page",
        type: "page",
      } as DesignNode),
    },
  });
  fakeApi.respond("variations.list", () => ({
    documents: [{ doc: HOME, sets: SETS }],
    rounds: [],
  }));
  stop = followServer({ report: () => undefined });
  await loadVariations("");
  act(() => openVariations({ frame: HOME, nodeId: "title" }));
});

afterEach(() => {
  const r = mounted;
  mounted = null;
  act(() => r?.unmount());
  document.body.innerHTML = "";
  stop();
});

describe("a thing's variations laid out beside its page", () => {
  it("names each over it, Original first and in use, with what it varied", () => {
    show();
    expect(
      [...document.querySelectorAll("[data-variation]")].map(
        (el) => el.textContent
      )
    ).toEqual(["OriginalIn use", "EditorialTone of the copy", "Loud"]);
  });

  it("says what each varied once, where several varied the same", () => {
    fakeApi.emit("variations", {
      doc: HOME,
      sets: {
        title: {
          inUse: "original",
          variations: [
            { id: "original", name: "Original" },
            { id: "v2", name: "Editorial", tree: heading("A"), varied: "Tone" },
            { id: "v3", name: "Loud", tree: heading("B"), varied: "Tone" },
            { id: "v4", name: "Wide", tree: heading("C"), varied: "Width" },
          ],
        },
      } as VariationSets,
    });
    show();
    expect(
      [...document.querySelectorAll("[data-variation]")].map(
        (el) => el.textContent
      )
    ).toEqual(["OriginalIn use", "EditorialTone", "Loud", "WideWidth"]);
  });

  it("lays them out past the page's right edge, two to a row, the first level with the thing", () => {
    show();
    const at = [...document.querySelectorAll("[data-variation]")].map((el) => {
      const { left, top } = (el as HTMLElement).style;
      return [Number.parseFloat(left), Number.parseFloat(top)];
    });
    expect(at).toEqual([
      [1520, 120],
      [2200, 120],
      [1520, 240],
    ]);
  });

  it("draws each as its own tree, the one in use as the page has it, at the page's breakpoint", () => {
    show();
    const drawnFor = (variation: string) =>
      renders.findLast(
        (r) => r.frame === `variation:${HOME}/title/${variation}`
      )?.request;
    const textOf = (request: RenderRequest | undefined) =>
      request?.root?.type === "text" ? request.root.text : undefined;
    expect(textOf(drawnFor("original"))).toBe("Drawing with constraints");
    expect(textOf(drawnFor("v2"))).toBe("Notes, now and then");
    // A 600 px heading of a 1440 px page is drawn as the page draws it: at `xl`.
    expect(drawnFor("v2")?.at).toBe("xl");
  });

  it("shows one in the preview on a click or ← →, outlined beside the page, the controls under it Reset and Use this", () => {
    show();
    expect(controls()).toBe("Done");
    expect(outline()).toBe("none");

    const shown = () =>
      document
        .querySelector('[aria-pressed="true"]')
        ?.getAttribute("aria-label");
    click(document.querySelector('[aria-label="Show Editorial"]'));
    // Its name is over it beside the page: the controls do not say it again.
    expect(controls()).toBe("ResetUse this");
    expect(shown()).toBe("Show Editorial");
    expect(outline()).toBe("dashed");

    press("arrowright");
    expect(shown()).toBe("Show Loud");
    press("arrowleft");
    press("arrowleft");
    expect(controls()).toBe("Done");
  });

  it("puts the preview back to the one in use on Reset", () => {
    show();
    click(document.querySelector('[aria-label="Show Loud"]'));
    click(
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Reset"
      )
    );
    expect(controls()).toBe("Done");
  });

  it("closes on Escape with nothing written", () => {
    show();
    click(document.querySelector('[aria-label="Show Loud"]'));
    press("escape");
    expect(document.querySelector("[data-variation]")).toBeNull();
    expect(fakeApi.calls.filter((c) => c.method === "variations.use")).toEqual(
      []
    );
  });

  it("close when something is selected on the canvas, the one in use kept", () => {
    show();
    click(document.querySelector('[aria-label="Show Loud"]'));
    act(() => select({ frame: HOME, nodeId: "page" }));
    expect(document.querySelector("[data-variation]")).toBeNull();
    expect(useVariations.getState().open).toBeNull();
    // → walks the selection again: into the page, to its heading.
    press("arrowright");
    expect(useEditor.getState().selection?.nodeId).toBe("title");
  });

  it("fits the camera again once each thing opened has its variations measured", () => {
    show();
    const measure = (node: string, height: number) =>
      act(() => {
        for (const id of ["original", "v2", "v3"]) {
          told
            .get(`variation:${HOME}/${node}/${id}`)
            ?.size?.({ height, width: 600 });
        }
      });
    measure("title", 50);
    expect(fits.count).toBe(2);

    // Another thing, whose variations have the same ids, is measured on its own.
    fakeApi.emit("variations", {
      doc: HOME,
      sets: { ...SETS, lede: SETS.title } as VariationSets,
    });
    act(() => closeVariations());
    act(() => openVariations({ frame: HOME, nodeId: "lede" }));
    expect(fits.count).toBe(3);
    measure("lede", 200);
    expect(fits.count).toBe(4);
  });
});

describe("the rest of the canvas while they are open (ADR 0098)", () => {
  const scrim = () =>
    document.querySelector("[data-variations-scrim]") as HTMLElement | null;
  /** A press and its release on the scrim, then the click a browser sends wherever it lands. */
  const pressOn = (el: Element | null) => {
    const options = { bubbles: true, button: 0 };
    act(() => {
      el?.dispatchEvent(new PointerEvent("pointerdown", options));
    });
    const scrimWas = el?.isConnected === true;
    act(() => {
      el?.dispatchEvent(new PointerEvent("pointerup", options));
      el?.dispatchEvent(new MouseEvent("click", options));
    });
    return scrimWas;
  };

  it("fades back under the variations, which lie over it", () => {
    show();
    const lift = (el: Element | null | undefined) =>
      Number((el as HTMLElement | null)?.style.zIndex);
    const variations =
      document.querySelector("[data-variation]")?.parentElement;
    expect(lift(variations)).toBeGreaterThan(lift(scrim()));
  });

  it("closes them on a click, keeping the one in use and selecting nothing under it", () => {
    show();
    click(document.querySelector('[aria-label="Show Loud"]'));
    // Still there at the release, so the click is its own and not what lies under it.
    expect(pressOn(scrim())).toBe(true);
    expect(useVariations.getState().open).toBeNull();
    expect(scrim()).toBeNull();
    expect(useEditor.getState().selection).toBeNull();
    expect(fakeApi.calls.filter((c) => c.method === "variations.use")).toEqual(
      []
    );
  });

  it("pans while Space is held, the variations kept open", () => {
    show();
    act(() => useEditor.setState({ spacePan: true }));
    pressOn(scrim());
    expect(useVariations.getState().open).not.toBeNull();
    expect(scrim()).not.toBeNull();
  });
});

describe("a whole page's variations (ADR 0098)", () => {
  beforeEach(async () => {
    fakeApi.respond("variations.list", () => ({
      documents: [
        {
          doc: HOME,
          sets: {
            page: {
              inUse: "original",
              variations: [
                { id: "original", name: "Original" },
                {
                  id: "bold",
                  name: "Bold",
                  tree: { children: [], id: "page", type: "page" },
                },
                {
                  id: "calm",
                  name: "Calm",
                  tree: { children: [], id: "page", type: "page" },
                },
              ],
            },
          } as VariationSets,
        },
      ],
      rounds: [],
    }));
    act(() => closeVariations());
    await loadVariations("");
    act(() => openVariations({ frame: HOME, nodeId: "page" }));
  });

  it("draws each filling its box, as its page fills its frame", () => {
    show();
    const surface = document.querySelector(
      // The page is drawn in the variation's second child, under its name.
      '[data-variation="bold"] > :nth-child(2)'
    ) as HTMLElement | null;
    expect([surface?.style.width, surface?.style.height]).toEqual([
      "1440px",
      "900px",
    ]);
  });

  it("leaves room under a row for the names over the next, at the zoom that fits them", () => {
    show();
    const at = [...document.querySelectorAll("[data-variation]")].map((el) => {
      const { left, top } = (el as HTMLElement).style;
      return [Number.parseFloat(left), Number.parseFloat(top)];
    });
    // An eighth of the page's 1440 px under the first row's 900 px.
    expect(at).toEqual([
      [1520, 0],
      [3040, 0],
      [1520, 1080],
    ]);
  });
});

describe("an agent's takes on the thing (ADR 0098)", () => {
  const round = (
    takes: { state: "working" | "handedIn" | "failed"; variation?: string }[],
    id = "take_1",
    thread = "thread_1"
  ): VariationRound => ({
    doc: HOME,
    id,
    node: "title",
    takes,
    thread,
    vary: "the tone",
  });

  const drawn = (kind: string) =>
    document.querySelectorAll(`[data-take="${kind}"]`).length;

  it("lays out those still coming after the others, and says how many more are coming", () => {
    show();
    act(() =>
      fakeApi.emit("variationRounds", [
        round([{ state: "handedIn", variation: "v3" }, { state: "working" }]),
      ])
    );
    expect(drawn("coming")).toBe(1);
    expect(controls()).toBe("1 more comingDone");
    act(() =>
      fakeApi.emit("variationRounds", [
        round([
          { state: "handedIn", variation: "v3" },
          { state: "handedIn", variation: "v4" },
        ]),
      ])
    );
    expect(drawn("coming")).toBe(0);
    expect(controls()).toBe("Done");
  });

  it("draws those that failed as red boxes, whose Try again asks the round's chat for as many again", async () => {
    fakeApi.respond("threads.prompt", () => undefined as never);
    show();
    act(() =>
      fakeApi.emit("variationRounds", [
        round([{ state: "failed" }, { state: "failed" }], "take_2", "thread_9"),
      ])
    );
    expect(drawn("failed")).toBe(2);
    // A second press before the round that replaces it begins asks nothing more.
    click(
      document.querySelector('[data-take="failed"] [aria-label="Try again"]')
    );
    click(
      document.querySelector('[data-take="failed"] [aria-label="Try again"]')
    );
    await act(() => fakeApi.requested("threads.prompt"));
    expect(
      fakeApi.calls.filter((c) => c.method === "threads.prompt")
    ).toHaveLength(1);
    expect(
      fakeApi.calls.find((c) => c.method === "threads.prompt")?.input
    ).toEqual({
      attachments: [],
      text: `/variations ${HOME}#title 2 the tone`,
      threadId: "thread_9",
    });
  });

  it("lays the thing's variations out once a round's first take comes in, or fails", () => {
    act(() => closeVariations());
    act(() =>
      fakeApi.emit("variationRounds", [
        round([{ state: "working" }, { state: "working" }]),
      ])
    );
    expect(useVariations.getState().open).toBeNull();
    act(() =>
      fakeApi.emit("variationRounds", [
        round([{ state: "handedIn", variation: "v3" }, { state: "working" }]),
      ])
    );
    expect(useVariations.getState().open).toMatchObject({
      frame: HOME,
      node: "title",
    });
  });
});

describe("one part of a variation (ADR 0098)", () => {
  const hero = (children: DesignNode[]) =>
    ({ children, id: "hero", type: "column" }) as DesignNode;
  const text = (id: string, words: string) =>
    ({ id, text: words, type: "text" }) as DesignNode;
  const aside = {
    children: [text("note", "PS")],
    id: "aside",
    name: "Aside",
    type: "column",
  } as DesignNode;

  /** The page's hero opened, with Editorial's: a kicker, its own title, and an aside. */
  const openHero = () => {
    act(() => closeVariations());
    act(() =>
      useDocuments.setState({
        docs: {
          [HOME]: stateOf(HOME, {
            children: [hero([text("title", "Notes"), text("lede", "Write")])],
            id: "page",
            type: "page",
          } as DesignNode),
        },
      })
    );
    useEditor.setState({
      rects: { [HOME]: { hero: { height: 200, width: 600, x: 32, y: 120 } } },
    });
    act(() =>
      fakeApi.emit("variations", {
        doc: HOME,
        sets: {
          hero: {
            inUse: "original",
            variations: [
              { id: "original", name: "Original" },
              {
                id: "v2",
                name: "Editorial",
                tree: hero([
                  text("kicker", "Field notes"),
                  text("title", "Notes, now and then"),
                  aside,
                ]),
              },
            ],
          },
        },
      })
    );
    act(() => openVariations({ frame: HOME, nodeId: "hero" }));
    show();
  };

  const doubleClickIn = (variation: string, hits: string[]) => {
    drawnAt.hits = hits;
    // As a browser fires it: two clicks, then the double-click.
    const target = document.querySelector(`[aria-label="Show ${variation}"]`);
    act(() => {
      for (const detail of [1, 2]) {
        target?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail })
        );
      }
      target?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, detail: 2 })
      );
    });
  };

  /** The preview's tree, as the page draws it: its ids, nested. */
  const previewShape = () => {
    const tree = drawnIn(useVariations.getState(), HOME);
    const shape = (n: DesignNode): unknown =>
      "children" in n && n.children
        ? [n.id, (n.children as DesignNode[]).map(shape)]
        : n.id;
    return tree ? shape(tree) : null;
  };

  const arrow = () =>
    document.querySelector("[data-part] button") as HTMLButtonElement | null;

  /** The right panel a test draws, taken down after it whatever the test found. */
  let panel: Root | null = null;
  afterEach(() => {
    const r = panel;
    panel = null;
    act(() => r?.unmount());
  });

  beforeEach(() => {
    drawnAt.hits = [];
    drawnAt.rects = {
      aside: { height: 40, width: 600, x: 0, y: 120 },
      hero: { height: 200, width: 600, x: 0, y: 0 },
      kicker: { height: 20, width: 600, x: 0, y: 0 },
      note: { height: 20, width: 600, x: 0, y: 130 },
      title: { height: 40, width: 600, x: 0, y: 30 },
    };
  });

  it("selects the outermost part under the pointer with a double-click inside a variation", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "aside", "note"]);
    expect(useVariations.getState().open?.part).toEqual({
      node: "aside",
      variation: "v2",
    });
  });

  it("selects a part one deeper with each double-click on the part selected", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "aside", "note"]);
    doubleClickIn("Editorial", ["hero", "aside", "note"]);
    expect(useVariations.getState().open?.part?.node).toBe("note");
  });

  it("selects the outermost part elsewhere in the variation with a double-click there", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "aside", "note"]);
    doubleClickIn("Editorial", ["hero", "title"]);
    expect(useVariations.getState().open?.part?.node).toBe("title");
  });

  it("keeps the preview as it was through the double-click's clicks", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    expect(useVariations.getState().open?.preview).toBe("original");
  });

  it("shows the part's fields in the right panel, read-only", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    expect(rightHasSubject()).toBe(true);
    const container = document.createElement("div");
    document.body.append(container);
    panel = createRoot(container);
    const r = panel;
    act(() => r.render(<Inspector />));
    const inspector = container.querySelector("[data-part-inspector]");
    expect(inspector?.textContent).toContain("In Editorial, read-only");
    // Read as any field is, and held back from presses.
    const fields = inspector?.querySelector("fieldset[data-read-only]");
    expect(fields?.hasAttribute("disabled")).toBe(true);
    expect(fields?.querySelector("[inert]")).toBeNull();
    const pressed = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    fields?.querySelector("button")?.dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
  });

  it("adds a part the preview lacks in its place in its parent, writing nothing", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    expect(arrow()?.getAttribute("aria-label")).toBe("Add to preview");
    click(arrow());
    expect(previewShape()).toEqual(["hero", ["kicker", "title", "lede"]]);
    expect(
      fakeApi.calls.filter(
        (c) =>
          c.method.startsWith("variations.") && c.method !== "variations.list"
      )
    ).toEqual([]);
  });

  it("says under the preview what it is made of", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    click(arrow());
    expect(controls()).toBe("Original with Editorial's paragraphResetUse this");
  });

  it("names the mix by the parts it holds, though the page changes since", () => {
    openHero();
    // Editorial in the preview, the Original's lede added to it.
    act(() => showVariation("v2"));
    drawnAt.rects.lede = { height: 20, width: 600, x: 0, y: 60 };
    doubleClickIn("Original", ["hero", "lede"]);
    click(arrow());
    expect(controls()).toBe("Editorial with Original's paragraphResetUse this");
    // The page loses its lede meanwhile: the mix is as it was put together.
    act(() =>
      useDocuments.setState({
        docs: {
          [HOME]: stateOf(HOME, {
            children: [hero([text("title", "Notes")])],
            id: "page",
            type: "page",
          } as DesignNode),
        },
      })
    );
    expect(controls()).toBe("Editorial with Original's paragraphResetUse this");
  });

  it("takes the parts back out on Reset", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    click(arrow());
    click(
      [...document.querySelectorAll("[data-variation-controls] button")].find(
        (b) => b.textContent === "Reset"
      )
    );
    expect(previewShape()).toBeNull();
  });

  it("names a part put in twice once", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    click(arrow());
    click(arrow());
    expect(controls()).toBe("Original with Editorial's paragraphResetUse this");
  });

  it("offers no arrow on a part of the variation the preview shows whole", () => {
    openHero();
    act(() => showVariation("v2"));
    doubleClickIn("Editorial", ["hero", "kicker"]);
    expect(arrow()?.parentElement?.closest("[hidden]")).not.toBeNull();
  });

  it("names only the part drawn once a later part holds an earlier one", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    click(arrow());
    // The whole of Editorial's hero, which holds its kicker.
    doubleClickIn("Editorial", ["hero"]);
    click(arrow());
    expect(useVariations.getState().open?.parts).toEqual([
      { node: "hero", variation: "v2" },
    ]);
    expect(controls()).toBe("Original with Editorial's columnResetUse this");
  });

  it("uses a part the preview has in place of its own", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "title"]);
    expect(arrow()?.getAttribute("aria-label")).toBe("Use in preview");
    click(arrow());
    const tree = drawnIn(useVariations.getState(), HOME);
    expect(
      tree && "children" in tree ? tree.children?.[0] : null
    ).toMatchObject({
      text: "Notes, now and then",
    });
  });

  it("cannot add a part whose parent the preview lacks too, and says why", () => {
    openHero();
    doubleClickIn("Editorial", ["hero", "aside", "note"]);
    doubleClickIn("Editorial", ["hero", "aside", "note"]);
    expect(arrow()?.disabled).toBe(true);
    // Said where it can be read, not only in a tooltip a disabled button never opens.
    expect(document.querySelector("[data-part]")?.textContent).toBe(
      "The preview has no Aside to put it in"
    );
  });

  it("puts the mix in use as a variation of its own on Use this", async () => {
    fakeApi.respond("variations.useTree", ({ doc }) => ({ doc, sets: {} }));
    openHero();
    doubleClickIn("Editorial", ["hero", "kicker"]);
    click(arrow());
    press("enter");
    // A second Use this while the first is saved saves nothing more, the part let go meanwhile.
    press("escape");
    press("enter");
    await act(() => fakeApi.requested("variations.useTree"));
    expect(
      fakeApi.calls.filter((c) => c.method === "variations.useTree")
    ).toHaveLength(1);
    expect(
      fakeApi.calls.find((c) => c.method === "variations.useTree")?.input
    ).toMatchObject({
      doc: HOME,
      name: "Original with Editorial's paragraph",
      node: "hero",
    });
    // Saved, the variations close, the part let go before it made no difference.
    await act(async () => {
      await Promise.resolve();
    });
    expect(useVariations.getState().open).toBeNull();
  });
});

describe("a link to a page variant from before ADR 0098", () => {
  const bold: VariationSets = {
    page: {
      inUse: "original",
      variations: [
        { id: "original", name: "Original" },
        {
          id: "bold",
          name: "Bold",
          tree: {
            children: [heading("LOUD")],
            id: "page",
            type: "page",
          } as DesignNode,
        },
      ],
    },
  };

  beforeEach(() => {
    act(() => closeVariations());
    useEditor.setState({ activePage: HOME });
  });

  it("lays its page's variations out, that one in the preview", () => {
    act(() => fakeApi.emit("variations", { doc: HOME, sets: bold }));
    act(() => showPageVariation(HOME, "bold"));
    expect(useVariations.getState().open).toMatchObject({
      doc: HOME,
      node: "page",
      preview: "bold",
    });
  });

  it("waits for the page's variations to be read, as its canvas opens", async () => {
    fakeApi.respond("variations.list", () => ({
      documents: [{ doc: HOME, sets: bold }],
      rounds: [],
    }));
    const reading = loadVariations("");
    act(() => showPageVariation(HOME, "bold"));
    expect(useVariations.getState().open).toBeNull();
    await act(() => reading);
    expect(useVariations.getState().open?.preview).toBe("bold");
  });

  it("is let go once the person is on another page", async () => {
    fakeApi.respond("variations.list", () => ({
      documents: [{ doc: HOME, sets: bold }],
      rounds: [],
    }));
    const reading = loadVariations("");
    act(() => showPageVariation(HOME, "bold"));
    useEditor.setState({ activePage: "other.page.json" });
    await act(() => reading);
    expect(useVariations.getState().open).toBeNull();
  });

  it("is let go though the person came back to its page before it was read", async () => {
    fakeApi.respond("variations.list", () => ({
      documents: [{ doc: HOME, sets: bold }],
      rounds: [],
    }));
    const reading = loadVariations("");
    act(() => showPageVariation(HOME, "bold"));
    useEditor.setState({ activePage: "other.page.json" });
    useEditor.setState({ activePage: HOME });
    await act(() => reading);
    expect(useVariations.getState().open).toBeNull();
  });
});
