/**
 * The little of a browser the editor's stores reach for when they are made: the URL, history and
 * local storage. Imported first by a test that runs them in node. The history keeps its entries,
 * and going back or forward tells the `popstate` listeners, as a browser does.
 */
const store = new Map<string, string>();

const ORIGIN = "http://localhost";

const location = {
  hostname: "localhost",
  href: `${ORIGIN}/`,
  origin: ORIGIN,
  pathname: "/",
  search: "",
};

const entries: string[] = ["/"];
let at = 0;
const popListeners = new Set<() => void>();

const show = (url: string) => {
  const parsed = new URL(url, ORIGIN);
  location.href = parsed.href;
  location.pathname = parsed.pathname;
  location.search = parsed.search;
};

const go = (delta: number) => {
  const to = at + delta;
  if (to < 0 || to >= entries.length) {
    return;
  }
  at = to;
  show(entries[at] as string);
  for (const listener of popListeners) {
    listener();
  }
};

const fakeWindow = {
  addEventListener: (type: string, listener: () => void) => {
    if (type === "popstate") {
      popListeners.add(listener);
    }
  },
  history: {
    back: () => go(-1),
    forward: () => go(1),
    go,
    get length() {
      return entries.length;
    },
    pushState: (_state: unknown, _title: string, url: string) => {
      entries.splice(at + 1, entries.length, url);
      at = entries.length - 1;
      show(url);
    },
    replaceState: (_state: unknown, _title: string, url: string) => {
      entries[at] = url;
      show(url);
    },
  },
  location,
  removeEventListener: (type: string, listener: () => void) => {
    if (type === "popstate") {
      popListeners.delete(listener);
    }
  },
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

/** What a test drives the fake browser with, in node, where it is the window. */
export const fakeBrowser = {
  /** The entries of the history, oldest first, and which one is shown. */
  history: () => ({ at, entries: [...entries] }),
  /** Starts over at `url`, an entry of its own, as a page loaded there. */
  visit: (url: string) => {
    entries.splice(0, entries.length, url);
    at = 0;
    show(url);
  },
};
