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
} from "@ultrapaint/contracts/rpc";

type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

/** How a request is answered: its answer, or a promise of it the test settles. */
export type Responder<M extends RequestName> = (
  input: RequestInput<M>
) => RequestOutput<M> | Promise<RequestOutput<M>>;

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
  /** The connection opens again, as it does after the server restarted. */
  connect: () => setState("open"),
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
  api: (): Pick<Connection, "on" | "request"> => fakeApi,
  useConnection: fakeConnection,
};
