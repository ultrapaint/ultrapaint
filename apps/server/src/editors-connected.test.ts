import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Scope } from "effect";
import { EditorsConnected } from "./editors-connected.ts";

describe("EditorsConnected (ADR 0083)", () => {
  it.effect(
    "is left by none at once, and by the last editor when it goes",
    () =>
      Effect.gen(function* () {
        const editors = yield* EditorsConnected;
        yield* editors.noneLeft;
        const first = yield* Scope.make();
        const second = yield* Scope.make();
        yield* Scope.provide(editors.hold, first);
        yield* Scope.provide(editors.hold, second);
        const left = yield* Effect.forkChild(editors.noneLeft, {
          startImmediately: true,
        });
        yield* Scope.close(first, Exit.void);
        // One editor is still there.
        assert.isUndefined(left.pollUnsafe());
        yield* Scope.close(second, Exit.void);
        yield* Fiber.join(left);
      }).pipe(Effect.provide(EditorsConnected.layer))
  );
});
