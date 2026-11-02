/**
 * A page's document file (ADR 0015): what its text holds, the ids it leaves out filled in, or what
 * is wrong with it, and the text a document is written as. Pure; the documents, the pages (a
 * page's links following it) and the snapshots read with it.
 */
import { type DesignNode, PageDocument } from "@ultrapaint/contracts/document";
import type { Conflict } from "@ultrapaint/contracts/errors";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { fillIds } from "@ultrapaint/design-document/ids";
import {
  canvasRoot,
  DOCUMENT_VERSION,
} from "@ultrapaint/design-document/tree";
import { Effect, Schema } from "effect";
import type { CanvasRead } from "./canvas-files.ts";

export const decodePage = Schema.decodeUnknownEffect(PageDocument);

/** What an error thrown by code that is not Effect's says: its message, or itself as text. */
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * What a document's text holds, with whether ids had to be filled in, or what is wrong with it.
 * A canvas's text is read with `readCanvas` (its project's `CanvasFiles`); without one, the text
 * is a page's.
 */
export const parseDocument = (
  text: string,
  readCanvas?: (text: string) => Effect.Effect<CanvasRead, Conflict>
): Effect.Effect<
  | { readonly filled: boolean; readonly root: DesignNode }
  | { readonly problem: string }
> =>
  readCanvas
    ? readCanvas(text).pipe(
        Effect.map(({ filled, layout }) => ({
          filled,
          root: canvasRoot(layout.nodes ?? []),
        })),
        Effect.catch((error) => Effect.succeed({ problem: error.message }))
      )
    : Effect.try({
        catch: (error) => `not JSON: ${messageOf(error)}`,
        try: () => JSON.parse(text) as unknown,
      }).pipe(
        Effect.flatMap((json) => {
          const filled = fillIds(json);
          return decodePage(json).pipe(
            Effect.map(({ root }) => ({ filled, root })),
            Effect.mapError((error) => error.message)
          );
        }),
        Effect.catch((problem) => Effect.succeed({ problem }))
      );

/** A page's tree as its file is written. */
export const pageText = (root: DesignNode): string =>
  serialiseDocument({ root, version: DOCUMENT_VERSION });
