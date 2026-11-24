import { type ErrorCode, errorCodes } from "@ultrapaint/contracts/errors";
import {
  commandRequests,
  type EventName,
  type EventPayload,
  eventNames,
  type RequestInput,
  type RequestName,
  type RequestOutput,
  type StreamInput,
  type StreamItem,
  type StreamName,
  UltrapaintRpcs,
} from "@ultrapaint/contracts/rpc";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  type Fiber,
  Layer,
  Predicate,
  Schedule,
  Stream,
} from "effect";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

export type ConnectionState = "connecting" | "open" | "closed";

const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;
/** How long a request the connection dropped under waits for it to open again, to be sent again. */
const RESEND_WAIT_MS = 10_000;

export class RequestError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "RequestError";
  }
}

type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

/** A request the connection dropped under, with the error said of it when it is not sent again. */
class DroppedRequest extends Error {
  readonly reported: RequestError;

  constructor(reported: RequestError) {
    super(reported.message);
    this.reported = reported;
  }
}

/** Throws a request's failure as the caller sees it: a dropped one as the error said of it. */
const rethrow = (error: unknown): never => {
  throw error instanceof DroppedRequest ? error.reported : error;
};

/** The flattened RPC client, seen through the two shapes this facade needs. */
type RequestCall = (
  tag: string,
  payload: unknown
) => Effect.Effect<unknown, unknown>;
type StreamCall = (
  tag: string,
  payload: unknown
) => Stream.Stream<unknown, unknown>;

/** A stream the editor follows: started at every connection open with what `input` says then. */
interface Followed {
  fiber: Fiber.Fiber<void> | null;
  readonly input: () => unknown;
  readonly onError: (error: RequestError) => void;
  readonly onItem: (item: unknown) => void;
  readonly tag: string;
}

const isCommand = (method: RequestName) =>
  (commandRequests as readonly string[]).includes(method);

/**
 * A command id (ADR 0130), made from random bytes: `crypto.randomUUID` is only there on a secure
 * origin, and an editor may be served over plain HTTP from another machine.
 */
const newCommandId = () =>
  `cmd_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")}`;

/**
 * Whether a request failed because the connection went under it, not because the server said
 * no: what the client says of a socket that closed, or the request cut off with it.
 */
const dropped = (cause: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(cause) ||
  Cause.squash(cause) instanceof RpcClientError.RpcClientError;

interface ConnectionOptions {
  onState?: (state: ConnectionState) => void;
  url: string;
}

const isWireError = (
  error: unknown
): error is { _tag: keyof typeof errorCodes; message: string } =>
  Predicate.hasProperty(error, "_tag") &&
  Predicate.isString(error._tag) &&
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
  readonly onOpen: (call: RequestCall, stream: StreamCall) => void;
}

/** One socket, from connect to disconnect. Succeeds with whether it ever opened. */
const runSession = (options: ConnectionOptions, hooks: SessionHooks) =>
  Effect.gen(function* () {
    const { url } = options;
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
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
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
    const client = yield* RpcClient.make(UltrapaintRpcs, {
      flatten: true,
    }).pipe(Effect.provideContext(services));
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
    hooks.onOpen(client as unknown as RequestCall, subscribe);
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
 * a backoff that resets once a connection opens. Requests in flight when the socket drops fail,
 * but for the ones that change a thread, which carry a command id and are sent again once it
 * opens (ADR 0130); event subscriptions and the streams followed are re-established on the next
 * session.
 */
export class Connection {
  private call: RequestCall | null = null;
  private stream: StreamCall | null = null;
  private readonly followed = new Set<Followed>();
  /** Who waits for the connection to open again: a request to send again. */
  private readonly opening = new Set<() => void>();
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
            console.error(`[ultrapaint] listener for "${event}" failed`, error);
          }
        }
      },
      onOpen: (call, stream) => {
        this.call = call;
        this.stream = stream;
        this.setState("open");
        for (const followed of this.followed) {
          this.start(followed);
        }
        for (const opened of this.opening) {
          opened();
        }
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
          this.stream = null;
          for (const followed of this.followed) {
            followed.fiber?.interruptUnsafe();
            followed.fiber = null;
          }
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

  /**
   * Sends a request. One that changes a thread (`commandRequests`) carries a command id, made
   * here when the caller gave none; when the connection drops under it, it is sent again with
   * the same id once the connection opens, and the server, which may have handled it already,
   * acts once (ADR 0130).
   */
  async request<M extends RequestName>(
    method: M,
    input: RequestInput<M>
  ): Promise<RequestOutput<M>> {
    if (!isCommand(method)) {
      return await this.send(method, input).catch(rethrow);
    }
    const given = (input as { readonly commandId?: string }).commandId;
    const command = {
      ...input,
      commandId: given ?? newCommandId(),
    } as RequestInput<M>;
    // The session it goes on: dropped, it is sent again on another one, never on this.
    const sent = this.call;
    try {
      return await this.send(method, command);
    } catch (error) {
      if (
        !(
          error instanceof DroppedRequest &&
          (await this.opened(RESEND_WAIT_MS, sent))
        )
      ) {
        return rethrow(error);
      }
      return await this.send(method, command).catch(rethrow);
    }
  }

  private async send<M extends RequestName>(
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
    const error = toRequestError(method, exit.cause);
    throw dropped(exit.cause) ? new DroppedRequest(error) : error;
  }

  /**
   * Resolves true once the connection is open on a session other than `failed`, at once when it
   * is; false after `ms`. The session a request was dropped with may not be cleared yet.
   */
  private opened(ms: number, failed: RequestCall | null): Promise<boolean> {
    if (this.call && this.call !== failed) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const done = (open: boolean) => {
        clearTimeout(timer);
        this.opening.delete(onOpen);
        resolve(open);
      };
      const onOpen = () => done(true);
      const timer = setTimeout(() => done(false), ms);
      this.opening.add(onOpen);
    });
  }

  /**
   * Follows a streaming RPC for as long as the caller asks: started now when the connection is
   * open, and again at every open with what `input` says then (where a thread's stream resumes
   * from, ADR 0130). A failure the server sends is given to `onError`, and the stream is not
   * started again until the next open; one that ends with the socket is not a failure. Returns
   * what stops following it.
   */
  follow<M extends StreamName>(
    method: M,
    input: () => StreamInput<M>,
    handlers: {
      readonly onError: (error: RequestError) => void;
      readonly onItem: (item: StreamItem<M>) => void;
    }
  ): () => void {
    const followed: Followed = {
      fiber: null,
      input,
      onError: handlers.onError,
      onItem: handlers.onItem as (item: unknown) => void,
      tag: method,
    };
    this.followed.add(followed);
    this.start(followed);
    return () => {
      this.followed.delete(followed);
      followed.fiber?.interruptUnsafe();
      followed.fiber = null;
    };
  }

  private start(followed: Followed) {
    const { stream } = this;
    if (!stream) {
      return;
    }
    followed.fiber?.interruptUnsafe();
    followed.fiber = Effect.runFork(
      stream(followed.tag, followed.input()).pipe(
        Stream.runForEach((item) =>
          Effect.sync(() => {
            // One listener that throws must not end the stream that feeds it.
            try {
              followed.onItem(item);
            } catch (error) {
              console.error(
                `[ultrapaint] listener for "${followed.tag}" failed`,
                error
              );
            }
          })
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (!dropped(cause)) {
              followed.onError(toRequestError(followed.tag, cause));
            }
          })
        )
      )
    );
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
