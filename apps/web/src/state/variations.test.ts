import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import type { VariationSets } from "@ultrapaint/contracts/variations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
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

  it("hears a change of the variations from the server", () => {
    fakeApi.emit("variations", { doc: HOME, sets: {} });
    expect(useVariations.getState().byDoc[HOME]).toBeUndefined();
  });
});
