/**
 * The little of a browser the editor's stores reach for when they are made: the URL, history and
 * local storage. Imported first by a test that runs them in node.
 */
const store = new Map<string, string>();

const fakeWindow = {
  addEventListener: () => undefined,
  history: {
    pushState: () => undefined,
    replaceState: () => undefined,
  },
  location: { hostname: "localhost", pathname: "/", search: "" },
  removeEventListener: () => undefined,
};

const fakeStorage = {
  clear: () => store.clear(),
  getItem: (key: string) => store.get(key) ?? null,
  removeItem: (key: string) => {
    store.delete(key);
  },
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
};

const globals = globalThis as Record<string, unknown>;
globals.window ??= fakeWindow;
globals.localStorage ??= fakeStorage;
