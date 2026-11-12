import {
  Context,
  Effect,
  Layer,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";

/**
 * How many editors hold the API's socket open. A server started for an agent outside the editor
 * (ADR 0083) is kept while an editor is connected to it after the agent has gone: the desktop
 * app may have attached to it meanwhile, and it must not lose its server.
 */
export class EditorsConnected extends Context.Service<
  EditorsConnected,
  {
    /** Counts one editor until the surrounding scope closes: its socket's request. */
    readonly hold: Effect.Effect<void, never, Scope.Scope>;
    /** Done once no editor is connected: at once when none is. */
    readonly noneLeft: Effect.Effect<void>;
  }
>()("ultrapaint/server/EditorsConnected") {
  static readonly layer = Layer.effect(
    EditorsConnected,
    Effect.gen(function* () {
      const count = yield* SubscriptionRef.make(0);
      return EditorsConnected.of({
        hold: Effect.acquireRelease(
          SubscriptionRef.update(count, (n) => n + 1),
          () => SubscriptionRef.update(count, (n) => n - 1)
        ),
        // The changes start with the count as it is.
        noneLeft: SubscriptionRef.changes(count).pipe(
          Stream.filter((n) => n === 0),
          Stream.runHead,
          Effect.asVoid
        ),
      });
    })
  );
}
