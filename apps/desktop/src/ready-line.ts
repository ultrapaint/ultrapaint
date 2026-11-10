/**
 * The line the server prints on stdout once it listens (`--ready-json`, ADR 0031): where it is,
 * and which run it is. A server that found one already running for the project prints that
 * one's line, with `attached`, and exits.
 */
import { Deferred, Effect, Result, Schema, Stream } from "effect";
import { ServerStartError } from "./errors.ts";

export const ReadyLine = Schema.Struct({
  /** The server found another already running for the project; this is that one's line. */
  attached: Schema.optional(Schema.Boolean),
  pid: Schema.Int,
  port: Schema.Int,
  token: Schema.String,
  url: Schema.String,
});
export type ReadyLine = typeof ReadyLine.Type;

const decodeLine = Schema.decodeUnknownResult(Schema.fromJsonString(ReadyLine));

/**
 * The first ready line on a server's stdout. A line that is not one (a log a dependency printed
 * before the server took stdout over) is passed over; a stream that ends without one is a server
 * that did not start.
 *
 * It is read without letting go of the rest: a pipe no one reads any more would end what writes
 * to it, `ssh` among them. The rest is read and dropped as long as the scope lasts.
 */
export const watchReadyLine = <E>(stdout: Stream.Stream<Uint8Array, E>) =>
  Effect.gen(function* () {
    const found = yield* Deferred.make<ReadyLine, ServerStartError>();
    yield* stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        Result.match(decodeLine(line.trim()), {
          onFailure: () => Effect.void,
          // The first one counts; any after it is not waited for.
          onSuccess: (ready) => Deferred.succeed(found, ready),
        })
      ),
      Effect.andThen(
        Deferred.fail(
          found,
          new ServerStartError({
            message: "the server stopped before it said where it listens",
          })
        )
      ),
      Effect.catch(() =>
        Deferred.fail(
          found,
          new ServerStartError({
            message: "the server's output could not be read",
          })
        )
      ),
      Effect.forkScoped
    );
    return yield* Deferred.await(found);
  });
