import { Clock, Effect, Random } from "effect";

/** `thread_lx3k9a_4f2k1`: sortable by creation time, unique enough for one local process. */
export const makeId = Effect.fnUntraced(function* (prefix: string) {
  const at = yield* Clock.currentTimeMillis;
  const salt = yield* Random.nextIntBetween(0, 36 ** 5);
  return `${prefix}_${at.toString(36)}_${salt.toString(36).padStart(5, "0")}`;
});
