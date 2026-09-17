import { type ErrorCode, errorCodes } from "@ultrapaint/contracts/errors";
import {
  UltrapaintRpcs,
  type EventName,
  type EventPayload,
  eventNames,
  type RequestInput,
  type RequestName,
  type RequestOutput,
} from "@ultrapaint/contracts/rpc";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  type Fiber,
  Layer,
  Schedule,
  Stream,
} from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

export type ConnectionState = "connecting" | "open" | "closed";

const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;

export class RequestError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "RequestError";
  }
}

type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

/** The flattened RPC client, seen through the two shapes this facade needs. */
type RequestCall = (
  tag: string,
  payload: unknown
) => Effect.Effect<unknown, unknown>;
type StreamCall = (
  tag: string,
  payload: undefined
) => Stream.Stream<unknown, unknown>;

export interface ConnectionOptions {
  onState?: (state: ConnectionState) => void;
  url: string;
  WebSocketImpl?: typeof WebSocket;
}

const isWireError = (
  error: unknown
): error is { _tag: keyof typeof errorCodes; message: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string" &&
  error._tag in errorCodes;

const toRequestError = (method: string, cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  if (isWireError(error)) {
    return new RequestError(errorCodes[error._tag], error.message);
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new RequestError("internal", `${method} failed: ${reason}`);
};

interface SessionHooks {
  readonly onEvent: (event: EventName, payload: unknown) => void;
  readonly onOpen: (call: RequestCall) => void;
}

/** One socket, from connect to disconnect. Succeeds with whether it ever opened. */
const runSession = (options: ConnectionOptions, hooks: SessionHooks) =>
  Effect.gen(function* () {
    const { url, WebSocketImpl } = options;
    const connected = yield* Deferred.make<void>();
    const disconnected = yield* Deferred.make<void>();
    const protocol = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        // Reconnecting is the supervisor's job; the protocol reports the first failure.
        retryPolicy: Schedule.recurs(0),
        retryTransientErrors: false,
      })
    ).pipe(
      Layer.provide(Socket.layerWebSocket(url)),
      Layer.provide(
        WebSocketImpl
          ? Layer.succeed(
              Socket.WebSocketConstructor,
              (target) => new WebSocketImpl(target)
            )
          : Socket.layerWebSocketConstructorGlobal
      ),
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(
        Layer.succeed(RpcClient.ConnectionHooks, {
          onConnect: Effect.asVoid(Deferred.succeed(connected, undefined)),
          onDisconnect: Effect.asVoid(
            Deferred.succeed(disconnected, undefined)
          ),
        })
      )
    );
    // Built into the session scope: `Effect.provide(layer)` would close the socket as soon
    // as the client had been constructed.
    const services = yield* Layer.build(protocol);
    const client = yield* RpcClient.make(UltrapaintRpcs, { flatten: true }).pipe(
      Effect.provideContext(services)
    );
    const opened = yield* Effect.raceFirst(
      Effect.as(Deferred.await(connected), true),
      Effect.as(Deferred.await(disconnected), false)
    );
    if (!opened) {
      return false;
    }
    // Subscribe before announcing the session: the editor loads its snapshots as soon as it
    // sees "open", and a change between a snapshot and its subscription would be lost.
    const streamEnded = yield* Deferred.make<void>();
    const subscribe = client as unknown as StreamCall;
    for (const event of eventNames) {
      yield* subscribe(`events.${event}`, undefined).pipe(
        Stream.runForEach((payload) =>
          Effect.sync(() => hooks.onEvent(event, payload))
        ),
        Effect.ignore,
        // These streams only end with the socket. One that ends on an open socket would leave
        // the editor deaf to that event, so it ends the session and the supervisor reconnects.
        Effect.ensuring(Deferred.succeed(streamEnded, undefined)),
        Effect.forkScoped
      );
    }
    hooks.onOpen(client as unknown as RequestCall);
    yield* Effect.raceFirst(
      Deferred.await(disconnected),
      Deferred.await(streamEnded)
    );
    return true;
  }).pipe(Effect.scoped);

/**
 * Typed client for the editor. `request` resolves with the decoded output of the named
 * request; `on` subscribes to a server event.
 *
 * Every socket gets its own RPC session and this class is the only thing that reconnects, with
 * a backoff that resets once a connection opens. Requests in flight when the socket drops fail;
 * event subscriptions are re-established on the next session.
 */
export class Connection {
  private call: RequestCall | null = null;
  private readonly listeners = new Map<EventName, Set<Listener<EventName>>>();
  private readonly supervisor: Fiber.Fiber<never>;
  private readonly options: ConnectionOptions;
  state: ConnectionState = "connecting";

  constructor(options: ConnectionOptions) {
    this.options = options;
    this.supervisor = Effect.runFork(this.supervise());
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.options.onState?.(state);
  }

  private supervise(): Effect.Effect<never> {
    const hooks: SessionHooks = {
      onEvent: (event, payload) => {
        for (const listener of this.listeners.get(event) ?? []) {
          // One listener that throws must not stop the others, or the stream that feeds them.
          try {
            listener(payload as never);
          } catch (error) {
            console.error(
              `[ultrapaint] listener for "${event}" failed`,
              error
            );
          }
        }
      },
      onOpen: (call) => {
        this.call = call;
        this.setState("open");
      },
    };
    const attempt = Effect.suspend(() => {
      this.setState("connecting");
      return runSession(this.options, hooks);
    }).pipe(
      Effect.orElseSucceed(() => false),
      Effect.ensuring(
        Effect.sync(() => {
          this.call = null;
          this.setState("closed");
        })
      )
    );
    let backoff = INITIAL_BACKOFF_MS;
    return Effect.forever(
      Effect.gen(function* () {
        if (yield* attempt) {
          backoff = INITIAL_BACKOFF_MS;
        }
        yield* Effect.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      })
    );
  }

  async request<M extends RequestName>(
    method: M,
    input: RequestInput<M>
  ): Promise<RequestOutput<M>> {
    const { call } = this;
    if (!call) {
      throw new RequestError("internal", "not connected");
    }
    // The facade erases the per-method error union; `toRequestError` recovers it by tag.
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off
    const exit = await Effect.runPromiseExit(call(method, input));
    if (Exit.isSuccess(exit)) {
      return exit.value as RequestOutput<M>;
    }
    throw toRequestError(method, exit.cause);
  }

  on<E extends EventName>(event: E, listener: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<EventName>);
    return () => set?.delete(listener as Listener<EventName>);
  }

  close() {
    this.supervisor.interruptUnsafe();
  }
}

/** Same origin as the page. Typed structurally so this module also loads outside a browser. */
export const defaultServerUrl = (): string => {
  const { location } = globalThis as unknown as {
    location: { host: string; protocol: string };
  };
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
};
