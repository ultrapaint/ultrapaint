import { Effect, Semaphore } from "effect";

export interface KeyedLock {
  readonly withLock: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

/** One permit per key, so two writers never interleave on the same file. */
export const makeKeyedLock = (): KeyedLock => {
  const locks = new Map<string, Semaphore.Semaphore>();
  return {
    withLock: (key, effect) =>
      Effect.suspend(() => {
        let lock = locks.get(key);
        if (!lock) {
          lock = Semaphore.makeUnsafe(1);
          locks.set(key, lock);
        }
        return lock.withPermits(1)(effect);
      }),
  };
};
