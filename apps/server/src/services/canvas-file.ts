/**
 * `canvas.json`'s one codec (ADR 0019): a canvas's layout read from its text, with the ids its
 * nodes leave out filled in, and written in one format whoever writes it: the pages service, the
 * documents' edits to the canvas's nodes, the ids filled in on reading. Pure but for what it keeps:
 * the layouts read and written last, by their text's hash, so an edit that reads the canvas before
 * its step, in it and again to tell the editors parses its text once.
 */
import { Conflict } from "@ultrapaint/contracts/errors";
import { CanvasLayout, emptyCanvasLayout } from "@ultrapaint/contracts/pages";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { fillIds } from "@ultrapaint/design-document/ids";
import { Effect, Schema } from "effect";
import { hashContent } from "../hash.ts";
import type { FileCodec } from "./edit.ts";

const decodeLayout = Schema.decodeUnknownEffect(CanvasLayout);

/** A layout read from a text, and whether ids had to be filled in to read it. */
export interface CanvasRead {
  readonly filled: boolean;
  readonly layout: CanvasLayout;
}

/** How many texts are kept: a canvas or two per editor open, each before and after an edit. */
const KEPT = 32;
const kept = new Map<string, CanvasRead>();

const keep = (hash: string, read: CanvasRead) => {
  kept.delete(hash);
  kept.set(hash, read);
  if (kept.size > KEPT) {
    const [oldest] = kept.keys();
    if (oldest !== undefined) {
      kept.delete(oldest);
    }
  }
};

const sortedKeys = <T>(record: Readonly<Record<string, T>>) =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

/**
 * A layout from the text of `canvas.json`, with the ids its nodes leave out filled in. Nodes
 * are the canvas's document; ids are what an operation names them by. The same text read again
 * is the same layout, the same ids included.
 */
export const readCanvasText = (
  text: string
): Effect.Effect<CanvasRead, Conflict> => {
  const hash = hashContent(text);
  const known = kept.get(hash);
  if (known) {
    keep(hash, known);
    return Effect.succeed(known);
  }
  return Effect.gen(function* () {
    const json = yield* Effect.try({
      catch: (error) =>
        new Conflict({ message: `canvas.json is not JSON: ${String(error)}` }),
      try: () => JSON.parse(text) as unknown,
    });
    const filled = fillIds(json);
    const layout = yield* decodeLayout(json).pipe(
      Effect.mapError(
        (error) =>
          new Conflict({ message: `canvas.json is invalid: ${error.message}` })
      )
    );
    const read = { filled, layout };
    keep(hash, read);
    return read;
  });
};

/**
 * `canvas.json` as it is written: what its pages are drawn in and what it is called first, keys
 * sorted, and no empty list. The routes are written even when there are none, since their absence
 * means a canvas from before pages had optional URLs. The layout is kept under the text, so the
 * next read of what was written parses nothing.
 */
export const canvasText = (layout: CanvasLayout): string => {
  const nodes = layout.nodes ?? [];
  const variants = layout.variants ?? [];
  const states = layout.states ?? [];
  const written: CanvasLayout = {
    ...(layout.defaults !== undefined && { defaults: layout.defaults }),
    ...(layout.name !== undefined && { name: layout.name }),
    ...(layout.home !== undefined && { home: layout.home }),
    ...(variants.length > 0 && { variants }),
    ...(states.length > 0 && { states }),
    ...(layout.routes !== undefined && { routes: sortedKeys(layout.routes) }),
    frames: sortedKeys(layout.frames),
    ...(nodes.length > 0 && { nodes }),
    version: 1,
  };
  const text = serialiseDocument(written);
  keep(hashContent(text), { filled: false, layout: written });
  return text;
};

/** The codec a step reads and writes `canvas.json` with: a canvas without one has no layout yet. */
export const canvasCodec: FileCodec<CanvasLayout, Conflict> = {
  decode: (text) =>
    text === null
      ? Effect.succeed(emptyCanvasLayout())
      : Effect.map(readCanvasText(text), (read) => read.layout),
  encode: canvasText,
};
