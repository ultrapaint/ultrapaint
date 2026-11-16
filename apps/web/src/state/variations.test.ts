import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { VariationSets } from "@ultrapaint/contracts/variations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useComponents } from "./components.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { rightHasSubject } from "./panels.ts";
import { select } from "./selection.ts";
import { followServer } from "./server-data.ts";
import {
  closeVariations,
  drawnIn,
  loadVariations,
  openVariations,
  previewDiffers,
  previewedComponents,
  previewOf,
  putPreviewInUse,
  showVariation,
  stepVariation,
  useVariations,
} from "./variations.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";

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

/** The title has three variations, the original in use. */
const SETS: VariationSets = {
  title: {
    inUse: "original",
    variations: [
      { id: "original", name: "Original" },
      { id: "v2", name: "Editorial", tree: heading("Notes, now and then") },
      { id: "v3", name: "Loud", tree: heading("GET THE NOTES") },
    ],
  },
};

const initialEditor = useEditor.getState();
const initialDocuments = useDocuments.getState();
const initialVariations = useVariations.getState();
let stop: () => void = () => undefined;

beforeEach(async () => {
  fakeApi.reset();
  useEditor.setState(initialEditor, true);
  useDocuments.setState(initialDocuments, true);
  useVariations.setState(initialVariations, true);
  useEditor.setState({
    canvas: "",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
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
});

afterEach(() => stop());

/** What was asked of the variations but reading them: what would write. */
const writes = () =>
  fakeApi.calls.filter(
    (c) => c.method.startsWith("variations.") && c.method !== "variations.list"
  );

describe("choosing among a thing's variations", () => {
  it("opens them with the one in use in the preview, and the right panel closed", () => {
    select({ frame: HOME, nodeId: "title" });
    openVariations({ frame: HOME, nodeId: "title" });
    expect(previewOf(useVariations.getState())).toBe("original");
    expect(rightHasSubject()).toBe(false);
  });

  it("shows a variation in the thing's place without writing anything", () => {
    openVariations({ frame: HOME, nodeId: "title" });
    showVariation("v2");
    expect(drawnIn(useVariations.getState(), HOME)).toEqual(
      heading("Notes, now and then")
    );
    expect(writes()).toEqual([]);
  });

  it("steps through the variations with ← and →, round from the last to the first", () => {
    openVariations({ frame: HOME, nodeId: "title" }, "v3");
    stepVariation(1);
    expect(previewOf(useVariations.getState())).toBe("original");
    stepVariation(-1);
    expect(previewOf(useVariations.getState())).toBe("v3");
  });

  it("puts the preview in use with one request, closes, and leaves the thing selected", async () => {
    fakeApi.respond("variations.use", ({ doc, variation }) => ({
      doc,
      sets: { title: { ...SETS.title, inUse: variation } } as VariationSets,
    }));
    openVariations({ frame: HOME, nodeId: "title" });
    showVariation("v2");
    await putPreviewInUse();
    expect(writes()).toEqual([
      {
        input: { doc: HOME, node: "title", variation: "v2" },
        method: "variations.use",
      },
    ]);
    expect(useVariations.getState().open).toBeNull();
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "title",
    });
  });

  it("closes on Done, the one in use kept and nothing written", async () => {
    openVariations({ frame: HOME, nodeId: "title" });
    showVariation("v3");
    closeVariations();
    // Use this with the one in use in the preview writes nothing either.
    openVariations({ frame: HOME, nodeId: "title" });
    await putPreviewInUse();
    expect(useVariations.getState().open).toBeNull();
    expect(drawnIn(useVariations.getState(), HOME)).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("gives back the selection opening them took when they close on Done", () => {
    select({ frame: HOME, nodeId: "title" });
    openVariations({ frame: HOME, nodeId: "title" });
    closeVariations();
    expect(useEditor.getState().selection).toEqual({
      frame: HOME,
      nodeId: "title",
    });
  });

  it("draws a part of a component's tree in the preview in its place, the rest as it is", () => {
    const card = {
      children: [
        heading("Sale"),
        { id: "ends", role: "paragraph", text: "Ends Sunday", type: "text" },
      ],
      id: "c-root",
      type: "column",
    } as unknown as DesignNode;
    useComponents.setState({
      components: [
        {
          name: "Card",
          origin: "app",
          properties: [],
          slots: [],
          tree: card,
          version: 1,
        } as never,
      ],
    });
    fakeApi.emit("variations", {
      doc: "component:Card",
      sets: {
        title: {
          inUse: "original",
          variations: [
            { id: "original", name: "Original" },
            { id: "v2", name: "Loud", tree: heading("SALE") },
          ],
        },
      },
    });
    openVariations(
      {
        doc: "component:Card",
        frame: "board:library/Card/component",
        nodeId: "title",
      },
      "v2"
    );
    const [drawn] = previewedComponents(useComponents.getState().components);
    expect((drawn as { tree: DesignNode }).tree).toMatchObject({
      children: [{ text: "SALE" }, { text: "Ends Sunday" }],
      id: "c-root",
    });
  });

  it("with none in use, starts from the thing as drawn and steps the variations from it", () => {
    fakeApi.emit("variations", {
      doc: HOME,
      sets: { title: { ...SETS.title, inUse: null } } as VariationSets,
    });
    openVariations({ frame: HOME, nodeId: "title" });
    expect(previewDiffers(useVariations.getState())).toBe(false);
    expect(drawnIn(useVariations.getState(), HOME)).toBeNull();
    stepVariation(1);
    expect(previewOf(useVariations.getState())).toBe("original");
    expect(previewDiffers(useVariations.getState())).toBe(true);
  });

  it("reads the thing as drawn in the preview as the one in use, once an undo puts one in use again", () => {
    fakeApi.emit("variations", {
      doc: HOME,
      sets: { title: { ...SETS.title, inUse: null } } as VariationSets,
    });
    openVariations({ frame: HOME, nodeId: "title" });
    fakeApi.emit("variations", { doc: HOME, sets: SETS });
    expect(previewDiffers(useVariations.getState())).toBe(false);
  });

  it("hears a change of the variations from the server", () => {
    fakeApi.emit("variations", { doc: HOME, sets: {} });
    expect(useVariations.getState().byDoc[HOME]).toBeUndefined();
  });
});
