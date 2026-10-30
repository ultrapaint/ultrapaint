/**
 * `implementation.json`'s codec (ADR 0030): the links between the designs and the code, read and
 * written whoever changes them, the implementation module or a page moved. Pure, as
 * `component-files` is.
 */
import { Conflict } from "@ultrapaint/contracts/errors";
import {
  type ImplementationEntry,
  ImplementationFile,
} from "@ultrapaint/contracts/implementation";
import { serialise } from "@ultrapaint/design-document/factories";
import { Effect, Schema } from "effect";
import type { FileCodec } from "./edit.ts";

const decodeFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ImplementationFile)
);

export const emptyFile = (): ImplementationFile => ({ items: {}, version: 1 });

/** The entries in order of their keys: the file is committed, and diffs well so. */
const sorted = (items: Readonly<Record<string, ImplementationEntry>>) =>
  Object.fromEntries(
    Object.entries(items).sort(([a], [b]) => a.localeCompare(b))
  );

/**
 * The file as a step reads and writes it: none yet is nothing bound, and one that does not read
 * is a `Conflict`, so that a caller can leave it as it is rather than write over it.
 */
export const implementationCodec: FileCodec<ImplementationFile, Conflict> = {
  decode: (text) =>
    text === null
      ? Effect.succeed(emptyFile())
      : decodeFile(text).pipe(
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `implementation.json does not read: ${error.message}`,
              })
          )
        ),
  encode: (file) => serialise({ items: sorted(file.items), version: 1 }),
};

/** A change to one entry of `implementation.json`, and the snapshot written or taken with it. */
export interface EntryEdit {
  readonly snapshot?: {
    readonly rel: string;
    /** Null takes the snapshot away. */
    readonly text: string | null;
  };
  readonly target: string;
  readonly update: (entry: ImplementationEntry) => ImplementationEntry | null;
}

/** The entries with the edits made, in order of their keys. */
export const withEdits = (
  items: Readonly<Record<string, ImplementationEntry>>,
  edits: readonly EntryEdit[]
): Record<string, ImplementationEntry> => {
  const next: Record<string, ImplementationEntry> = { ...items };
  for (const { target, update } of edits) {
    const entry = update(next[target] ?? {});
    delete next[target];
    if (entry !== null) {
      next[target] = entry;
    }
  }
  return sorted(next);
};

/**
 * The entries with the designs moved (`from` → `to`) or gone (`to` null): a design moved keeps
 * its entry under its new target, one gone takes it away. Answers with the moves that named an
 * entry, whose designs as they were implemented go the same way; none when nothing was bound.
 */
export const rebind = (
  items: Readonly<Record<string, ImplementationEntry>>,
  moves: ReadonlyMap<string, string | null>
): {
  readonly bound: readonly (readonly [from: string, to: string | null])[];
  readonly items: Record<string, ImplementationEntry>;
} => {
  const bound = [...moves].filter(([from]) => from in items);
  return {
    bound,
    items: withEdits(
      items,
      bound.flatMap(([from, to]) => {
        const entry = items[from] as ImplementationEntry;
        return [
          { target: from, update: () => null },
          ...(to === null ? [] : [{ target: to, update: () => entry }]),
        ];
      })
    ),
  };
};
