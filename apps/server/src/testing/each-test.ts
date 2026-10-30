import { describe, it } from "@effect/vitest";
import { Effect, type Layer, type Scope } from "effect";
import { TestClock } from "effect/testing";

/**
 * When the test clock starts in a world of `perTest`'s: a fixed instant, as the real clock
 * never reads 0 (a time of 0 is what the server writes for "never", as DESIGN.md's baseline
 * does).
 */
export const TEST_EPOCH = Date.UTC(2026, 0, 1);

/** `it.effect`, on a world of each test's own. */
export interface EachTest<R> {
  readonly effect: <A, E>(
    name: string,
    body: () => Effect.Effect<A, E, R | Scope.Scope>,
    timeout?: number
  ) => void;
}

/** A block of tests, named or not, as `layer(world)` takes one. */
export interface EachTestBlock<R> {
  (tests: (test: EachTest<R>) => void): void;
  (name: string, tests: (test: EachTest<R>) => void): void;
}

/** Whether the tests run on the real clock, and why. */
export interface EachTestOptions {
  /**
   * Puts the tests on the real clock, saying why: what they wait for is IO they cannot be told
   * about (a real watcher, an agent's process, a socket), polled with `waitFor`.
   */
  readonly realClock?: string;
}

/**
 * Tests on a world of each one's own (docs/TESTING.md rule 3): `world` is built afresh for every
 * test, and for every repeat of one, and closed when the test ends. A `layer(...)` shared by a
 * block is for what no test changes; a project, a server or a store a test writes to is built
 * here. The tests run on the test clock, from `TEST_EPOCH`, unless `realClock` says why not.
 */
export const perTest = <R, E>(
  world: Layer.Layer<R, E>,
  options: EachTestOptions = {}
): EachTest<R> => ({
  effect: (name, body, timeout) => {
    const inWorld = () => body().pipe(Effect.provide(world), Effect.scoped);
    if (options.realClock === undefined) {
      it.effect(
        name,
        () => Effect.andThen(TestClock.setTime(TEST_EPOCH), inWorld()),
        timeout
      );
    } else {
      // real clock: only when the caller says why, in `realClock`.
      it.live(name, inWorld, timeout);
    }
  },
});

/**
 * `perTest`, written as a `layer(world)` block is: `eachTest(world)("name", (it) => ...)` reads
 * as the block it replaces, but no test sees another's world.
 */
export const eachTest = <R, E>(
  world: Layer.Layer<R, E>,
  options: EachTestOptions = {}
): EachTestBlock<R> => {
  const test = perTest(world, options);
  return ((
    nameOrTests: string | ((test: EachTest<R>) => void),
    tests?: (test: EachTest<R>) => void
  ) => {
    if (typeof nameOrTests === "string") {
      describe(nameOrTests, () => tests?.(test));
    } else {
      nameOrTests(test);
    }
  }) as EachTestBlock<R>;
};
