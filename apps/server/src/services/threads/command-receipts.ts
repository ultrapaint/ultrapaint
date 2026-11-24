import { Deferred, Effect, Fiber } from "effect";

/** How many requests' results are kept to answer one sent again (ADR 0130). */
export const COMMAND_RECEIPTS_KEPT = 256;

/**
 * The results of the last requests that changed a thread, by the command id the editor made for
 * each (ADR 0130): a request sent again with an id kept is answered with the first one's result,
 * its success or its failure, and does nothing; one still under way is answered when it ends.
 * Kept in memory, `COMMAND_RECEIPTS_KEPT` at most, the oldest forgotten first.
 *
 * `fork` starts a request's work detached from the caller, so that a request cut short by its
 * socket closing still ends, and its receipt with it, for the one sent again. The receipt is kept
 * and its work started in one uninterruptible step: a receipt never waits on work never started.
 */
export const makeCommandReceipts = (
  fork: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<Fiber.Fiber<A, E>>
) => {
  const receipts = new Map<string, Deferred.Deferred<unknown, unknown>>();
  return <A, E>(
    commandId: string | undefined,
    act: Effect.Effect<A, E>
  ): Effect.Effect<A, E> =>
    commandId === undefined
      ? act
      : Effect.uninterruptibleMask((restore) => {
          const known = receipts.get(commandId) as
            | Deferred.Deferred<A, E>
            | undefined;
          if (known) {
            return restore(Deferred.await(known));
          }
          const receipt = Deferred.makeUnsafe<A, E>();
          receipts.set(
            commandId,
            receipt as Deferred.Deferred<unknown, unknown>
          );
          if (receipts.size > COMMAND_RECEIPTS_KEPT) {
            const [oldest] = receipts.keys();
            if (oldest !== undefined) {
              receipts.delete(oldest);
            }
          }
          // The work as interruptible as it was; only waiting for it is the caller's.
          return Effect.flatMap(
            fork(
              restore(
                Effect.onExit(act, (exit) => Deferred.done(receipt, exit))
              )
            ),
            (fiber) => restore(Fiber.join(fiber))
          );
        });
};
