// @vitest-environment happy-dom

import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { VariationSets } from "@ultrapaint/contracts/variations";
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
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { select } from "../state/selection.ts";
import { followServer } from "../state/server-data.ts";
import {
  closeVariations,
  loadVariations,
  openVariations,
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
        hitTest: () => [],
        measure: () => ({}),
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

  it("shows one in the preview on a click or ← →, the controls under it saying what it is", () => {
    show();
    expect(controls()).toBe("Done");
    expect(outline()).toBe("none");

    click(document.querySelector('[aria-label="Show Editorial"]'));
    expect(controls()).toContain("Editorial");
    expect(controls()).toContain("Reset");
    expect(controls()).toContain("Use this");
    expect(outline()).toBe("dashed");

    press("arrowright");
    expect(controls()).toContain("Loud");
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
