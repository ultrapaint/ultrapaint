import { CanvasId, FileId } from "@ultrapaint/contracts/base";
import { NotFound } from "@ultrapaint/contracts/errors";
import { Clock, Effect, Random, Schema } from "effect";

/** `thread_lx3k9a_4f2k1`: sortable by creation time, unique enough for one local process. */
export const makeId = Effect.fnUntraced(function* (prefix: string) {
  const at = yield* Clock.currentTimeMillis;
  const salt = yield* Random.nextIntBetween(0, 36 ** 5);
  return `${prefix}_${at.toString(36)}_${salt.toString(36).padStart(5, "0")}`;
});

const isFileId = Schema.is(FileId);
const isCanvasId = Schema.is(CanvasId);

/**
 * The id, before it is joined into a path: one the server could have made, which names nothing
 * outside the directory it is joined to. The RPC schemas check the same, but an id also comes
 * from an agent's tool call and from files on disk, and this is where it becomes a path. `what`
 * says what the id is of, for the message.
 */
export const safeFileId = (what: string, id: string) =>
  isFileId(id)
    ? Effect.succeed(id)
    : Effect.fail(
        new NotFound({ message: `no ${what} ${JSON.stringify(id)}` })
      );

/** The same for a canvas, which is a directory inside the designs directory, or that itself. */
export const safeCanvasId = (id: string) =>
  isCanvasId(id)
    ? Effect.succeed(id)
    : Effect.fail(new NotFound({ message: `canvas not found: ${id}` }));
