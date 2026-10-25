/**
 * The links to the code (ADR 0030) moved with the pages they are for, inside an action on them:
 * a page renamed, or moved to another canvas, keeps its binding and the design as it was
 * implemented under its new id; a page deleted, alone or with its canvas, takes them along; undo
 * brings them back. A copy is a new design and starts with none. A file that does not read is
 * left as it is.
 */
import {
  IMPLEMENTATION_FILE,
  implementedFileOf,
} from "@ultrapaint/contracts/implementation";
import { Effect, Predicate } from "effect";
import type { EditTransaction } from "./edit.ts";
import type { PagesReading } from "./pages-reading.ts";

/** A page's id, from its canvas and its path inside it. */
export const idOf = (canvas: string, pagePath: string) =>
  canvas === "" ? pagePath : `${canvas}/${pagePath}`;

export const makeBindings = (
  reading: Pick<PagesReading, "exists" | "fs" | "path" | "paths" | "root">
) => {
  const { exists, fs, path, paths, root } = reading;

  /** `implementation.json` as it reads, its items apart; null when there is none, or it does not read. */
  const readBindings = Effect.fnUntraced(function* (file: string) {
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.orElseSucceed((): string | null => null));
    const parsed: unknown =
      text === null
        ? null
        : yield* Effect.try(() => JSON.parse(text) as unknown).pipe(
            Effect.orElseSucceed(() => null)
          );
    return Predicate.isObject(parsed) &&
      "items" in parsed &&
      Predicate.isObject(parsed.items)
      ? { items: parsed.items, parsed }
      : null;
  });

  /** One page's design as it was implemented, moved with it or taken away. */
  const moveImplemented = Effect.fnUntraced(function* (
    tx: EditTransaction,
    from: string,
    to: string | null
  ) {
    const kept = path.join(root, implementedFileOf(from));
    if (!(yield* exists(kept))) {
      return;
    }
    yield* to === null
      ? tx.remove(paths.relative(kept))
      : tx.move(
          paths.relative(kept),
          paths.relative(path.join(root, implementedFileOf(to)))
        );
  });

  /** The bindings of the pages moved (`from` → `to`) or gone (`to` null), with their snapshots. */
  const rebind = Effect.fnUntraced(function* (
    tx: EditTransaction,
    moves: ReadonlyMap<string, string | null>
  ) {
    const file = path.join(root, IMPLEMENTATION_FILE);
    const found = yield* readBindings(file);
    const bound = [...moves].filter(([from]) => found && from in found.items);
    if (!found || bound.length === 0) {
      return;
    }
    const next: Record<string, unknown> = { ...found.items };
    for (const [from, to] of bound) {
      const item = next[from];
      delete next[from];
      if (to !== null) {
        next[to] = item;
      }
      yield* moveImplemented(tx, from, to);
    }
    const sorted = Object.fromEntries(
      Object.entries(next).sort(([a], [b]) => a.localeCompare(b))
    );
    yield* tx.write(
      paths.relative(file),
      `${JSON.stringify({ ...found.parsed, items: sorted }, null, 2)}\n`
    );
  });

  return { rebind };
};
