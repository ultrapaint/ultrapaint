import { Context, Deferred, Effect, Layer } from "effect";

/**
 * The port the server listens on: the one asked for, or the one the system gave for `--port 0`.
 * Known once the server listens, which is after the services are built (`server.ts`); whatever
 * names the server's own address, the MCP URL handed to agents, asks here at the moment of use.
 * Binding port 0 directly leaves no gap in which another process could take a port picked
 * beforehand.
 */
export class ListenPort extends Context.Service<
  ListenPort,
  {
    /** Waits until the server listens. */
    readonly get: Effect.Effect<number>;
    /** Said once, by the layer that opens the port. */
    readonly listening: (port: number) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ListenPort") {
  static readonly layer = Layer.effect(
    ListenPort,
    Effect.map(Deferred.make<number>(), (port) =>
      ListenPort.of({
        get: Deferred.await(port),
        listening: (value) => Effect.asVoid(Deferred.succeed(port, value)),
      })
    )
  );
}
