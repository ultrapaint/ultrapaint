import { type Duration, Effect } from "effect";

/**
 * What `read` gives once `done` holds of it, reading again every `every` (25 ms) and failing
 * with a timeout after `within` (20 s). For a test that waits on IO it cannot hear about (a
 * server over its socket, a file a watcher writes), on the clock it runs on: an end-to-end test
 * runs on the real one. A test that can be told when something changed waits for that instead
 * (`threadWhen` in `threads.ts`).
 */
export const waitFor = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  done: (value: A) => boolean,
  options: {
    readonly every?: Duration.Input;
    readonly within?: Duration.Input;
  } = {}
) =>
  Effect.gen(function* () {
    for (;;) {
      const value = yield* read;
      if (done(value)) {
        return value;
      }
      yield* Effect.sleep(options.every ?? "25 millis");
    }
  }).pipe(Effect.timeout(options.within ?? "20 seconds"));
