/**
 * The line the server prints on stdout once it listens (`--ready-json`, ADR 0031): where it is,
 * and which run it is. A server that found one already running for the project prints that
 * one's line, with `attached`, and exits.
 */
import { Effect, Option, Schema, Stream } from "effect";
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
 */
export const firstReadyLine = <E>(stdout: Stream.Stream<Uint8Array, E>) =>
  stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) => decodeLine(line.trim())),
    Stream.runHead,
    Effect.mapError(
      () =>
        new ServerStartError({
          message: "the server's output could not be read",
        })
    ),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new ServerStartError({
              message: "the server stopped before it said where it listens",
            })
          ),
        onSome: Effect.succeed,
      })
    )
  );
