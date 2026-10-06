/**
 * The server connection, for tests of the stores: requests are answered by whatever a test sets
 * up, and the server's events are sent by the test.
 */
type Listener = (payload: never) => void;
type Responder = (input: never) => unknown;

const listeners = new Map<string, Set<Listener>>();
const responders = new Map<string, Responder>();

export const fakeApi = {
  /** Every request made, in order. */
  calls: [] as { input: unknown; method: string }[],
  /** Sends an event as the server would. */
  emit: (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      (listener as (p: unknown) => void)(payload);
    }
  },
  on: (event: string, listener: Listener) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return () => set.delete(listener);
  },
  request: (method: string, input: unknown): Promise<unknown> => {
    fakeApi.calls.push({ input, method });
    const responder = responders.get(method);
    return Promise.resolve(
      responder ? (responder as (i: unknown) => unknown)(input) : undefined
    );
  },
  /** Forgets the requests made and the answers set up; the listeners stay bound. */
  reset: () => {
    fakeApi.calls.length = 0;
    responders.clear();
  },
  /** How a request is answered: a value, or a promise the test settles. */
  respond: (method: string, responder: Responder) => {
    responders.set(method, responder);
  },
};

/** What `vi.mock("…/state/connection.ts")` stands in with. */
export const connectionModule = {
  api: () => fakeApi,
  useConnection: { getState: () => ({ connection: fakeApi, state: "open" }) },
};
