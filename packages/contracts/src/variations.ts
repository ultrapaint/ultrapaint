/**
 * Variations (ADR 0098): other ways to draw something on the canvas, kept with it. A thing's
 * variations are a **set**, by the thing's node id, in a designs file beside its document
 * (`notes.variations.json` for `notes.page.json`). Of a set, one variation is **in use**: the
 * tree in the document. Its entry holds no tree of its own, so an edit lands on it and nothing is
 * kept twice; the others keep theirs. The first is the **original**, the thing as it was before.
 */
import { Schema } from "effect";
import { COMPONENT_EXTENSION } from "./component-names.ts";
import { DesignNode } from "./document.ts";

/** The id of a set's first variation: the thing as it was before any other. */
export const ORIGINAL_ID = "original";

/** One way to draw a thing. */
export const Variation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Its tree, the thing's id at its root; absent for the one in use, which is the document's. */
  tree: Schema.optional(DesignNode),
  /** What it varied, as the agent said it ("Tone of the copy"); none for one made by hand. */
  varied: Schema.optional(Schema.String),
});
export type Variation = typeof Variation.Type;

/** A thing's variations, the original first, and which one is in use. */
export const VariationSet = Schema.Struct({
  inUse: Schema.String,
  variations: Schema.Array(Variation),
});
export type VariationSet = typeof VariationSet.Type;

/** The sets of a document's things, by node id. */
export const VariationSets = Schema.Record(Schema.String, VariationSet);
export type VariationSets = typeof VariationSets.Type;

/** The designs file beside a document. */
export const VariationsFile = Schema.Struct({
  sets: VariationSets,
  version: Schema.Literal(1),
});
export type VariationsFile = typeof VariationsFile.Type;

/** A document's variations, as the editor is told them. */
export const DocumentVariations = Schema.Struct({
  doc: Schema.String,
  sets: VariationSets,
});
export type DocumentVariations = typeof DocumentVariations.Type;

/** The variations of every document of a canvas, and of every component. */
export const VariationsList = Schema.Struct({
  documents: Schema.Array(DocumentVariations),
});
export type VariationsList = typeof VariationsList.Type;

/** A thing: a node of a document. */
export const VariationTarget = Schema.Struct({
  doc: Schema.String,
  node: Schema.String,
});
export type VariationTarget = typeof VariationTarget.Type;

export const VARIATIONS_EXTENSION = ".variations.json";

const EXTENSIONS = [".page.json", COMPONENT_EXTENSION, ".json"];

/**
 * The variations file beside a document's file: `notes.page.json` keeps them in
 * `notes.variations.json`, a canvas's `canvas.json` in `canvas.variations.json`, the component
 * `components/Card.component.json` in `components/Card.variations.json`.
 */
export const variationsFileOf = (documentFile: string): string => {
  const extension = EXTENSIONS.find((e) => documentFile.endsWith(e)) ?? "";
  return `${documentFile.slice(0, documentFile.length - extension.length)}${VARIATIONS_EXTENSION}`;
};
