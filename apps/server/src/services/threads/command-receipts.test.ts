import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { makeCommandReceipts } from "./command-receipts.ts";

/** Receipts whose work runs in a scope of the test's own. */
const receiptsIn = (scope: Scope.Scope) =>
  makeCommandReceipts((effect) => Effect.forkIn(effect, scope));

describe("a request sent again (ADR 0130)", () => {
  it.effect(
    "while the first is under way waits for it, and the work runs once",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const command = receiptsIn(scope);
        const release = yield* Deferred.make<void>();
        let runs = 0;
        const act = Effect.andThen(
          Effect.sync(() => {
            runs += 1;
          }),
          Effect.as(Deferred.await(release), "done")
        );
        const first = yield* Effect.forkChild(command("c_1", act), {
          startImmediately: true,
        });
        const again = yield* Effect.forkChild(command("c_1", act), {
          startImmediately: true,
        });
        yield* Deferred.succeed(release, undefined);
        assert.strictEqual(yield* Fiber.join(first), "done");
        assert.strictEqual(yield* Fiber.join(again), "done");
        assert.strictEqual(runs, 1);
        yield* Scope.close(scope, Exit.void);
      })
  );

  it.effect(
    "after the first failed is answered with its failure, and does nothing",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const command = receiptsIn(scope);
        let runs = 0;
        const act = Effect.andThen(
          Effect.sync(() => {
            runs += 1;
          }),
          Effect.fail("refused" as const)
        );
        assert.strictEqual(yield* Effect.flip(command("c_2", act)), "refused");
        assert.strictEqual(yield* Effect.flip(command("c_2", act)), "refused");
        assert.strictEqual(runs, 1);
        yield* Scope.close(scope, Exit.void);
      })
  );
});
