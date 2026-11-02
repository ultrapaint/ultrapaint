import { CanvasId, FileId } from "@ultrapaint/contracts/base";
import { NotFound } from "@ultrapaint/contracts/errors";
import { Clock, Effect, Random, Schema } from "effect";

const SALTS = 36 ** 5;

/**
 * The last id's millisecond and salt, of the whole process: the ids of one millisecond take
 * salts that follow each other, so that two of them sort as they were made.
 */
const last = { at: Number.NaN, salt: 0 };

/**
 * `thread_lx3k9a_4f2k1`: unique enough for one local process, and sortable by creation: by time,
 * and within a millisecond by the order they were made (`newestFirst`). A millisecond's first
 * salt is random, in the lower half so that those after it do not run out.
 */
export const makeId = Effect.fnUntraced(function* (prefix: string) {
  const at = yield* Clock.currentTimeMillis;
  const salt =
    at === last.at && last.salt + 1 < SALTS
      ? last.salt + 1
      : yield* Random.nextIntBetween(0, SALTS / 2);
  last.at = at;
  last.salt = salt;
  return `${prefix}_${at.toString(36)}_${salt.toString(36).padStart(5, "0")}`;
});

/**
 * Newest first, for a list of what has the time it was made and an id of `makeId`'s: two made
 * in the same millisecond are in the order their ids were made, the later first. Of two kept
 * before ids were made in order, that order is their ids', the same every time.
 */
export const newestFirst =
  <T>(at: (item: T) => number, id: (item: T) => string) =>
  (a: T, b: T) => {
    const [idA, idB] = [id(a), id(b)];
    return at(b) - at(a) || (idB < idA ? -1 : Number(idB > idA));
  };

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
