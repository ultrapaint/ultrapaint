/**
 * `canvas.json`'s one codec (ADR 0019): a canvas's layout read from its text, with the ids its
 * nodes leave out filled in, and written in one format whoever writes it: the pages service, the
 * documents' edits to the canvas's nodes, the ids filled in on reading. The format is pure
 * (`canvasText`, `parseCanvasText`); an open project's `CanvasFiles` keeps the layout each of its
 * canvases was read or written as last, so an edit that reads the canvas before its step, in it
 * and again to tell the editors parses its text once.
 */
import { Conflict } from "@ultrapaint/contracts/errors";
import { CanvasLayout, emptyCanvasLayout } from "@ultrapaint/contracts/pages";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { fillIds } from "@ultrapaint/design-document/ids";
import { Context, Effect, Layer, Schema } from "effect";
import { hashContent, sortedByKey } from "../hash.ts";
import type { FileCodec } from "./edit.ts";

const decodeLayout = Schema.decodeUnknownEffect(CanvasLayout);

/** A layout read from a text, and whether ids had to be filled in to read it. */
export interface CanvasRead {
  readonly filled: boolean;
  readonly layout: CanvasLayout;
}

/**
 * A layout from the text of `canvas.json`, with the ids its nodes leave out filled in. Nodes
 * are the canvas's document; ids are what an operation names them by. Parsed every time: the
 * ids filled in are new each time, so a project reads its own canvases with `CanvasFiles`.
 */
export const parseCanvasText = Effect.fnUntraced(function* (
  text: string
): Effect.fn.Return<CanvasRead, Conflict> {
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
  return { filled, layout };
});

/** What `canvasText` writes: the layout in its one format. */
const writtenOf = (layout: CanvasLayout): CanvasLayout => {
  const nodes = layout.nodes ?? [];
  const variants = layout.variants ?? [];
  const states = layout.states ?? [];
  return {
    ...(layout.defaults !== undefined && { defaults: layout.defaults }),
    ...(layout.name !== undefined && { name: layout.name }),
    ...(layout.home !== undefined && { home: layout.home }),
    ...(variants.length > 0 && { variants }),
    ...(states.length > 0 && { states }),
    ...(layout.routes !== undefined && { routes: sortedByKey(layout.routes) }),
    frames: sortedByKey(layout.frames),
    ...(nodes.length > 0 && { nodes }),
    version: 1,
  };
};

/**
 * `canvas.json` as it is written: what its pages are drawn in and what it is called first, keys
 * sorted, and no empty list. The routes are written even when there are none, since their absence
 * means a canvas from before pages had optional URLs.
 */
export const canvasText = (layout: CanvasLayout): string =>
  serialiseDocument(writtenOf(layout));

/** A value and everything in it made read-only, as a layout every caller is handed is. */
const deepFreeze = <A>(value: A): A => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
};

/**
 * An open project's canvases as their files are read and written: each canvas's layout kept
 * under the text it was read or written as last, one per canvas, so the next read of the same
 * text parses nothing and gives the same layout, the same ids included. What is kept is the
 * project's own (its layer is built with the project) and read-only, since every caller is
 * handed the same layout; a canvas read in another version replaces what was kept for it.
 */
export class CanvasFiles extends Context.Service<
  CanvasFiles,
  {
    /** The layout of `file`'s text, `file` the canvas.json it was read from, repo-relative. */
    readonly read: (
      file: string,
      text: string
    ) => Effect.Effect<CanvasRead, Conflict>;
    /**
     * The codec a step reads and writes `file` with: a canvas without one has no layout yet,
     * and what it writes is kept, so the next read of what was written parses nothing.
     */
    readonly codec: (file: string) => FileCodec<CanvasLayout, Conflict>;
  }
>()("ultrapaint/server/CanvasFiles") {
  static readonly layer = Layer.sync(CanvasFiles, () => {
    const kept = new Map<string, { hash: string; read: CanvasRead }>();

    const keep = (file: string, hash: string, found: CanvasRead) => {
      const frozen = deepFreeze(found);
      kept.set(file, { hash, read: frozen });
      return frozen;
    };

    const read = Effect.fn("CanvasFiles.read")(function* (
      file: string,
      text: string
    ) {
      const hash = hashContent(text);
      const known = kept.get(file);
      if (known?.hash === hash) {
        return known.read;
      }
      return keep(file, hash, yield* parseCanvasText(text));
    });

    const codec = (file: string): FileCodec<CanvasLayout, Conflict> => ({
      decode: (text) =>
        text === null
          ? Effect.succeed(emptyCanvasLayout())
          : Effect.map(read(file, text), (known) => known.layout),
      encode: (layout) => {
        // A copy is kept, so the caller's layout stays the caller's to change.
        const written = structuredClone(writtenOf(layout));
        const text = serialiseDocument(written);
        keep(file, hashContent(text), { filled: false, layout: written });
        return text;
      },
    });

    return CanvasFiles.of({ codec, read });
  });
}
