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

const MADE_ID_RE = /^v\d+$/;

/**
 * The variation a page variant from before ADR 0098 is folded into: its name (`bold`), or, for a
 * name a variation of the page's own may have (`original`, `v2`), `variant-<name>`.
 */
export const pageVariantId = (name: string): string =>
  name === ORIGINAL_ID || MADE_ID_RE.test(name) ? `variant-${name}` : name;

/** A set's first variation while it is in use: its tree is the document's. */
export const ORIGINAL = { id: ORIGINAL_ID, name: "Original" } as const;

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

/**
 * A thing's variations, the original first, and which one is in use: none once the one in use is
 * deleted, the thing drawn as it was until another is used.
 */
export const VariationSet = Schema.Struct({
  inUse: Schema.NullOr(Schema.String),
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

/** A thing: a node of a document. */
export const VariationTarget = Schema.Struct({
  doc: Schema.String,
  node: Schema.String,
});
export type VariationTarget = typeof VariationTarget.Type;

/**
 * Where an agent's take stands: being made in its working copy, handed in as the variation it
 * made, or failed, its copy still unnamed when the turn ended.
 */
export const TakeState = Schema.Literals(["working", "handedIn", "failed"]);
export type TakeState = typeof TakeState.Type;

/**
 * A round of takes an agent is making of a thing, on a `Variations` task (ADR 0098): one take
 * per working copy the server made before the turn. The editor draws those still coming as
 * placeholders and those that failed as a red box with Try again.
 */
export const VariationRound = Schema.Struct({
  ...VariationTarget.fields,
  id: Schema.String,
  /** One per take asked for, in the order the copies were made. */
  takes: Schema.Array(
    Schema.Struct({
      state: TakeState,
      /** The variation it made, once handed in. */
      variation: Schema.optional(Schema.String),
    })
  ),
  /** The chat the round runs in: Try again asks there. */
  thread: Schema.String,
  /** What should vary, as the person said it. */
  vary: Schema.optional(Schema.String),
});
export type VariationRound = typeof VariationRound.Type;

/** The variations of every document of a canvas, and of every component. */
export const VariationsList = Schema.Struct({
  documents: Schema.Array(DocumentVariations),
  /** The rounds under way, and those with a take that failed, of every document. */
  rounds: Schema.Array(VariationRound),
});
export type VariationsList = typeof VariationsList.Type;

/** How many of a round's takes are where `state` says. */
export const takesIn = (
  round: Pick<VariationRound, "takes">,
  state: TakeState
): number => round.takes.filter((t) => t.state === state).length;

/** A thing as a `/variations` command names it: `<document>#<node>`. */
export const variationRefOf = (target: VariationTarget): string =>
  `${target.doc}#${target.node}`;

/** The thing a `/variations` command names; null when it names no node. */
export const targetOfRef = (ref: string): VariationTarget | null => {
  const at = ref.lastIndexOf("#");
  const doc = ref.slice(0, at);
  const node = ref.slice(at + 1);
  return at > 0 && node !== "" ? { doc, node } : null;
};

/** What separates a take's name from what it varied, as an agent names its working copy. */
export const TAKE_NAME_SEPARATOR = " · ";
/** The separator as an agent may space it: a dot between spaces, or ending the name. */
const SEPARATOR_RE = /\s+·(?:\s+|$)/;

/**
 * A take's name and what it varied, from the name an agent gave its working copy: "Editorial ·
 * Tone of the copy". A name without the separator varied nothing it said.
 */
export const takeNameOf = (
  named: string
): { readonly name: string; readonly varied?: string } => {
  const text = named.trim();
  // The text is trimmed: a separator, which starts with a space, is never its start.
  const match: RegExpExecArray | null = SEPARATOR_RE.exec(text);
  if (match === null) {
    return { name: text };
  }
  const name = text.slice(0, match.index).trim();
  const varied = text.slice(match.index + match[0].length).trim();
  return varied === "" ? { name } : { name, varied };
};

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
