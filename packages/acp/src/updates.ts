/**
 * The session updates an agent sends, as both adapters hand them to the host: one at a time, in
 * the order they came, by a consumer the adapter runs in its own scope. A call whose answer
 * follows updates (a prompt's turn, a session reopened) is over for the host only once those
 * updates are handled; a session loaded replays its history, which the host has already and
 * does not hear again.
 */
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { Deferred, Effect, Queue, type Scope } from "effect";

export interface Updates {
  /**
   * Runs `effect`, dropping the updates that arrive until it has answered and they have all
   * come in: the replay of a session loaded.
   */
  readonly dropping: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  /** Takes an update as it arrives; never waits. */
  readonly receive: (notification: SessionNotification) => void;
  /** Completes once every update received so far has been handled, or dropped. */
  readonly settled: Effect.Effect<void>;
}

type Inbox =
  | {
      readonly _tag: "Update";
      readonly dropped: boolean;
      readonly notification: SessionNotification;
    }
  | { readonly _tag: "Marker"; readonly reached: Deferred.Deferred<void> };

/**
 * The updates of one agent, handed to `onUpdate` until the scope closes. `arrived` is what it
 * takes for every update sent before an answer to have been received: the SDK answers a request
 * at once but dispatches notifications through an async chain, so the live adapter waits a
 * macrotask; an agent in memory has nothing to wait for.
 */
export const makeUpdates = Effect.fnUntraced(function* (
  onUpdate: (notification: SessionNotification) => Effect.Effect<void>,
  arrived: Effect.Effect<void> = Effect.void
): Effect.fn.Return<Updates, never, Scope.Scope> {
  const inbox = yield* Queue.unbounded<Inbox>();
  let dropping = 0;

  // One item at a time, so a marker is reached only after everything queued before it is
  // handled. A handler that breaks is logged, and the updates after it are still handled.
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(inbox), (item) => {
        if (item._tag === "Marker") {
          return Effect.asVoid(Deferred.succeed(item.reached, undefined));
        }
        return item.dropped
          ? Effect.void
          : onUpdate(item.notification).pipe(
              Effect.catchDefect((defect) =>
                Effect.logError("a session update broke its handler", defect)
              )
            );
      })
    )
  );

  const settled = Effect.gen(function* () {
    yield* arrived;
    const reached = yield* Deferred.make<void>();
    yield* Queue.offer(inbox, { _tag: "Marker", reached });
    yield* Deferred.await(reached);
  });

  return {
    dropping: (effect) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          dropping += 1;
        }),
        () => Effect.tap(effect, () => settled),
        () =>
          Effect.sync(() => {
            dropping -= 1;
          })
      ),
    receive: (notification) => {
      Queue.offerUnsafe(inbox, {
        _tag: "Update",
        dropped: dropping > 0,
        notification,
      });
    },
    settled,
  };
});
