/**
 * A document's variations file (ADR 0098), `notes.variations.json` beside `notes.page.json`: its
 * codec, which file a document keeps them in, and the rules every change of the file keeps. Pure.
 */
import {
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
} from "@ultrapaint/contracts/components";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { Conflict } from "@ultrapaint/contracts/errors";
import {
  VARIATIONS_EXTENSION,
  type VariationSet,
  type VariationSets,
  VariationsFile,
  variationsFileOf,
} from "@ultrapaint/contracts/variations";
import {
  childrenOf,
  idsOf,
  PAGE_EXTENSION,
  walk,
} from "@ultrapaint/design-document/tree";
import { CANVAS_FILE } from "@ultrapaint/shared/canvas";
import { Effect, Schema } from "effect";
import type { EditFailure, EditTransaction, FileCodec } from "./edit.ts";

const decodeFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(VariationsFile)
);

/** The file as it is written: its sets by node id in order, so a change reads as one in git. */
export const renderVariations = (sets: VariationSets) =>
  `${JSON.stringify(
    {
      sets: Object.fromEntries(
        Object.entries(sets).sort(([a], [b]) => (a < b ? -1 : 1))
      ),
      version: 1,
    },
    null,
    2
  )}\n`;

/**
 * A variations file as a step reads and writes it: a document without one has no variations
 * yet, and one left with none is written as no file (`writeSets`).
 */
export const variationsCodec = (
  file: string
): FileCodec<VariationSets, Conflict> => ({
  decode: (text) =>
    text === null
      ? Effect.succeed({})
      : decodeFile(text).pipe(
          Effect.map((read) => read.sets),
          Effect.mapError(
            (error) =>
              new Conflict({ message: `${file} is invalid: ${error.message}` })
          )
        ),
  encode: renderVariations,
});

/** The sets as text to write, or null when none are left and the file goes. */
const textOfSets = (sets: VariationSets): string | null =>
  Object.keys(sets).length === 0 ? null : renderVariations(sets);

/** The file written with the sets, or removed when none are left. */
export const writeSets = (
  tx: EditTransaction,
  file: string,
  sets: VariationSets
): Effect.Effect<void, EditFailure> => {
  const text = textOfSets(sets);
  return text === null ? tx.remove(file) : tx.write(file, text);
};

/**
 * A copy of a document's file (`from`, `to` repo-relative) takes its variations along: they name
 * its node ids, which the copy keeps.
 */
export const copyVariationsFile = Effect.fnUntraced(function* (
  tx: EditTransaction,
  from: string,
  to: string
) {
  const text = yield* tx.read(variationsFileOf(from));
  if (text !== null) {
    yield* tx.create(variationsFileOf(to), text);
  }
});

const CANVAS_VARIATIONS = `${CANVAS_FILE.slice(0, -".json".length)}${VARIATIONS_EXTENSION}`;

/**
 * The document file a variations file is beside, both designs-relative and posix: a page's, a
 * canvas's `canvas.json`, a component's.
 */
export const documentFileOfVariations = (file: string): string => {
  const base = file.slice(0, file.length - VARIATIONS_EXTENSION.length);
  if (file === CANVAS_VARIATIONS || file.endsWith(`/${CANVAS_VARIATIONS}`)) {
    return `${base}.json`;
  }
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  return dir === COMPONENTS_DIR
    ? `${base}${COMPONENT_EXTENSION}`
    : `${base}${PAGE_EXTENSION}`;
};

/** Every node the variations of a set keep a tree of. */
const nodesKeptBy = (set: VariationSet): DesignNode[] =>
  set.variations.flatMap((v) => (v.tree ? Array.from(walk(v.tree)) : []));

/**
 * The sets that still have their thing: drawn in the document, or in a variation not in use of a
 * set kept (a page's original that holds a heading with variations of its own). A set whose
 * thing is in none of them is gone with it; its own variations do not keep it.
 */
export const setsStillDrawn = (
  sets: VariationSets,
  root: DesignNode | null
): VariationSets => {
  const drawn = new Set(root === null ? [] : idsOf(root));
  const kept = new Set<string>();
  let grown = true;
  while (grown) {
    const reached = Object.entries(sets).filter(
      ([id]) => !kept.has(id) && drawn.has(id)
    );
    for (const [id, set] of reached) {
      kept.add(id);
      for (const node of nodesKeptBy(set)) {
        drawn.add(node.id);
      }
    }
    grown = reached.length > 0;
  }
  const entries = Object.entries(sets);
  return kept.size === entries.length
    ? sets
    : Object.fromEntries(entries.filter(([id]) => kept.has(id)));
};

/**
 * The operations that put `take` in place of the node with its id. A page's root cannot be
 * replaced, so its fields are set and its children put in its place instead; every id the take
 * holds is kept.
 */
export const opsPutting = (
  root: DesignNode,
  take: DesignNode
): readonly DocOp[] => {
  if (take.id !== root.id) {
    return [{ ids: [take.id], node: take, op: "replace" }];
  }
  const fieldsOf = (node: DesignNode) =>
    Object.fromEntries(
      Object.entries(node).filter(
        ([key]) => key !== "id" && key !== "children" && key !== "type"
      )
    );
  const now = fieldsOf(root);
  const next = fieldsOf(take);
  // A component's root may be a group, a row or a column in one variation and another in the next.
  const set: Record<string, unknown> = {
    ...next,
    ...(take.type !== root.type && { type: take.type }),
  };
  for (const key of Object.keys(now)) {
    if (!(key in next)) {
      set[key] = null;
    }
  }
  return [
    { id: root.id, op: "update", set: set as Record<string, never> },
    ...childrenOf(root).map((child): DocOp => ({ id: child.id, op: "remove" })),
    ...childrenOf(take).map(
      (child, index): DocOp => ({
        index,
        node: child,
        op: "insert",
        parent: root.id,
      })
    ),
  ];
};
