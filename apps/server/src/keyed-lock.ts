import { Effect, Semaphore } from "effect";

export interface KeyedLock {
  /** How many keys hold a lock now: those with work running or waiting. */
  readonly size: () => number;
  readonly withLock: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

/**
 * One permit per key, so two writers never interleave on the same file. A key's lock lasts as
 * long as someone holds it or waits for it: keys come and go with threads, files and pages, and
 * the locks of those gone would otherwise stay for the life of the server.
 */
export const makeKeyedLock = (): KeyedLock => {
  const locks = new Map<
    string,
    { readonly lock: Semaphore.Semaphore; users: number }
  >();
  return {
    size: () => locks.size,
    withLock: (key, effect) =>
      Effect.suspend(() => {
        let entry = locks.get(key);
        if (!entry) {
          entry = { lock: Semaphore.makeUnsafe(1), users: 0 };
          locks.set(key, entry);
        }
        const held = entry;
        held.users += 1;
        return held.lock
          .withPermits(1)(effect)
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                held.users -= 1;
                if (held.users === 0 && locks.get(key) === held) {
                  locks.delete(key);
                }
              })
            )
          );
      }),
  };
};
