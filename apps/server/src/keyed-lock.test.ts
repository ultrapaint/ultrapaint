import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { makeKeyedLock } from "./keyed-lock.ts";

describe("a keyed lock", () => {
  it.effect(
    "runs one holder of a key at a time and forgets the idle keys",
    () =>
      Effect.gen(function* () {
        const lock = makeKeyedLock();
        const order: string[] = [];
        const release = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
          lock.withLock(
            "page",
            Effect.andThen(
              Effect.sync(() => order.push("first in")),
              Effect.andThen(
                Deferred.await(release),
                Effect.sync(() => order.push("first out"))
              )
            )
          )
        );
        yield* Effect.yieldNow;
        const second = yield* Effect.forkChild(
          lock.withLock(
            "page",
            Effect.sync(() => order.push("second"))
          )
        );
        // Another key is not held up.
        yield* lock.withLock(
          "other",
          Effect.sync(() => order.push("other"))
        );
        yield* Effect.yieldNow;
        assert.strictEqual(lock.size(), 1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        assert.deepStrictEqual(order, [
          "first in",
          "other",
          "first out",
          "second",
        ]);
        assert.strictEqual(lock.size(), 0);
        // A failure lets go of the key too.
        yield* Effect.flip(lock.withLock("page", Effect.fail("no")));
        assert.strictEqual(lock.size(), 0);
      })
  );
});
