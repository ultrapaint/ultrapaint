/**
 * The server connection, for tests of the stores: requests are answered by whatever a test sets
 * up, and the server's events are sent by the test. Typed by the contracts, as `api()` is: a
 * request's input and answer, and an event's payload, are the ones the server's would be.
 */
import {
  type Connection,
  type ConnectionState,
  RequestError,
} from "@ultrapaint/client-runtime/connection";
import type {
  EventName,
  EventPayload,
  RequestInput,
  RequestName,
  RequestOutput,
  StreamInput,
  StreamItem,
  StreamName,
} from "@ultrapaint/contracts/rpc";

type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

/** How a request is answered: its answer, or a promise of it the test settles. */
export type Responder<M extends RequestName> = (
  input: RequestInput<M>
) => RequestOutput<M> | Promise<RequestOutput<M>>;

/**
 * What a stream followed sends as it starts: what it would send up to `synchronized`, or nothing
 * yet for a test that sends it (`send`). A stream with none set up fails as it starts, as a
 * request with no answer does.
 */
export type StreamResponder<M extends StreamName> = (
  input: StreamInput<M>
) => readonly StreamItem<M>[];

/** A stream the editor follows, as `Connection.follow` keeps it. */
interface Follower {
  readonly handlers: {
    readonly onError: (error: RequestError) => void;
    readonly onItem: (item: never) => void;
  };
  readonly input: () => unknown;
  readonly method: StreamName;
}

interface ConnectionStore {
  connection: typeof fakeApi;
  state: ConnectionState;
}

const listeners = new Map<EventName, Set<Listener<EventName>>>();
/** Each kept as its method's, which `respond` checked. */
const responders = new Map<RequestName, (input: never) => unknown>();
const watchers = new Set<
  (now: ConnectionStore, before: ConnectionStore) => void
>();
const followers = new Set<Follower>();
/** Followers whose stream failed: told nothing until it starts again, at the next open. */
const failed = new Set<Follower>();
const streamResponders = new Map<StreamName, (input: never) => unknown>();

/** Starts a stream followed: what it was asked with is kept, and its answer sent. */
const start = (follower: Follower) => {
  failed.delete(follower);
  const input = follower.input();
  fakeApi.started.push({ input, method: follower.method });
  const responder = streamResponders.get(follower.method);
  if (!responder) {
    follower.handlers.onError(
      new RequestError("internal", `${follower.method}: no answer was set up`)
    );
    return;
  }
  for (const item of responder(input as never) as never[]) {
    follower.handlers.onItem(item);
  }
};

/** Who waits for requests (`requested`): looked at again with every request made. */
const requestWaiters = new Set<() => void>();
let store: ConnectionStore;

const callsOf = (method: RequestName) =>
  fakeApi.calls.filter((c) => c.method === method).length;

const setState = (state: ConnectionState) => {
  const before = store;
  store = { ...store, state };
  for (const watcher of watchers) {
    watcher(store, before);
  }
};

export const fakeApi = {
  /** Every request made, in order. */
  calls: [] as { input: unknown; method: RequestName }[],
  /** The connection opens again, as it does after the server restarted: the streams start again. */
  connect: () => {
    setState("open");
    for (const follower of followers) {
      start(follower);
    }
  },
  /** The connection drops: requests fail, and what the server sends meanwhile is lost. */
  disconnect: () => setState("closed"),
  /** Sends an event as the server would; nobody hears it while the connection is down. */
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => {
    if (store.state !== "open") {
      return;
    }
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  },
  /** Fails every stream of `method` followed, as the server would: they are not started again. */
  failStream: (method: StreamName, error: RequestError) => {
    for (const follower of followers) {
      if (follower.method === method) {
        failed.add(follower);
        follower.handlers.onError(error);
      }
    }
  },
  follow: <M extends StreamName>(
    method: M,
    input: () => StreamInput<M>,
    handlers: {
      readonly onError: (error: RequestError) => void;
      readonly onItem: (item: StreamItem<M>) => void;
    }
  ) => {
    const follower: Follower = { handlers, input, method };
    followers.add(follower);
    if (store.state === "open") {
      start(follower);
    }
    return () => {
      followers.delete(follower);
      failed.delete(follower);
    };
  },
  on: <E extends EventName>(event: E, listener: Listener<E>) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener as Listener<EventName>);
    listeners.set(event, set);
    return () => {
      set.delete(listener as Listener<EventName>);
    };
  },
  request: <M extends RequestName>(
    method: M,
    input: RequestInput<M>
  ): Promise<RequestOutput<M>> => {
    if (store.state !== "open") {
      return Promise.reject(new RequestError("internal", "not connected"));
    }
    fakeApi.calls.push({ input, method });
    for (const waiter of requestWaiters) {
      waiter();
    }
    const responder = responders.get(method) as Responder<M> | undefined;
    if (!responder) {
      return Promise.reject(
        new RequestError("internal", `${method}: no answer was set up`)
      );
    }
    return Promise.resolve(responder(input));
  },
  /**
   * Resolves once `count` requests of `method` have been made, at once when they have: what a
   * test awaits for a request a gesture or an answer sets off, rather than time passing
   * (docs/TESTING.md rule 2).
   */
  requested: (method: RequestName, count = 1): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (callsOf(method) >= count) {
          requestWaiters.delete(check);
          resolve();
        }
      };
      requestWaiters.add(check);
      check();
    }),
  /**
   * Forgets the requests made, the answers set up, who listens to the events and to the
   * connection, and opens it: what follows the server binds again (`followServer`).
   */
  reset: () => {
    fakeApi.calls.length = 0;
    fakeApi.started.length = 0;
    followers.clear();
    failed.clear();
    streamResponders.clear();
    requestWaiters.clear();
    responders.clear();
    listeners.clear();
    watchers.clear();
    store = { connection: fakeApi, state: "open" };
  },
  /** How a request is answered from now on. */
  respond: <M extends RequestName>(method: M, responder: Responder<M>) => {
    responders.set(method, responder);
  },
  /** What each stream of `method` followed sends as it starts, from now on. */
  respondStream: <M extends StreamName>(
    method: M,
    responder: StreamResponder<M>
  ) => {
    streamResponders.set(method, responder);
  },
  /** Sends an item on every stream of `method` followed; nobody hears it while the connection is down. */
  send: <M extends StreamName>(method: M, item: StreamItem<M>) => {
    if (store.state !== "open") {
      return;
    }
    for (const follower of followers) {
      if (follower.method === method && !failed.has(follower)) {
        follower.handlers.onItem(item as never);
      }
    }
  },
  /** Every stream started, with what it was asked: at `follow` and at each connection open. */
  started: [] as { input: unknown; method: StreamName }[],
};

store = { connection: fakeApi, state: "open" };

/** The connection's store, as the editor reads and watches it (`useConnection`). */
const fakeConnection = {
  getState: () => store,
  subscribe: (
    watcher: (now: ConnectionStore, before: ConnectionStore) => void
  ) => {
    watchers.add(watcher);
    return () => {
      watchers.delete(watcher);
    };
  },
};

/** What `vi.mock("…/state/connection.ts")` stands in with. */
export const connectionModule = {
  api: (): Pick<Connection, "follow" | "on" | "request"> => fakeApi,
  useConnection: fakeConnection,
};
