/**
 * The application's storage (docs/PLAN-preview-sandbox.md, step 9). In the editor's page its
 * origin is the editor's: it would read and clear the editor's keys, and what it stored would last
 * from one load to the next, a canvas drawn differently because a stored "theme" or "onboarded"
 * said so. The preview's code gets storage of its own instead:
 *
 * - `localStorage` and `sessionStorage` are kept in memory, empty at every load, one of each for
 *   every frame, as the application's modules are one copy for every frame (ADR 0034);
 * - IndexedDB databases are named apart, anew at every load, the last loads' deleted.
 *
 * Whose code asks is told by its immediate caller, as `requests.ts` does not need to: nothing
 * wraps `localStorage` for the editor.
 */

/** What a database the preview's code opens is named under. */
const DATABASE_PREFIX = "ultrapaint-preview:";

/** A `Storage` in memory: its methods, and its keys read and written as properties. */
export const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  const methods: Storage = {
    clear: () => items.clear(),
    getItem: (key: string) => items.get(String(key)) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
    removeItem: (key: string) => {
      items.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      items.set(String(key), String(value));
    },
  };
  Object.setPrototypeOf(methods, Storage.prototype);
  return new Proxy(methods, {
    deleteProperty: (_target, key) => {
      if (typeof key === "string") {
        items.delete(key);
      }
      return true;
    },
    get: (target, key) => {
      if (typeof key !== "string" || key in target) {
        return Reflect.get(target, key, target);
      }
      return items.get(key);
    },
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === "string" && items.has(key)
        ? {
            configurable: true,
            enumerable: true,
            value: items.get(key),
            writable: true,
          }
        : undefined,
    has: (target, key) =>
      (typeof key === "string" && items.has(key)) || key in target,
    ownKeys: () => [...items.keys()],
    set: (target, key, value) => {
      if (typeof key !== "string" || key in target) {
        return Reflect.set(target, key, value, target);
      }
      items.set(key, String(value));
      return true;
    },
  });
};

/** Puts the preview's storage apart from the editor's, once. `isPreview` says whose call it is. */
export const guardStorage = (isPreview: (patched: object) => boolean) => {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const descriptor =
      Object.getOwnPropertyDescriptor(window, name) ??
      Object.getOwnPropertyDescriptor(Window.prototype, name);
    const native = descriptor?.get;
    if (!native) {
      continue;
    }
    const own = memoryStorage();
    const get = () => (isPreview(get) ? own : native.call(window));
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get,
    });
  }

  const factory = window.indexedDB as IDBFactory | undefined;
  if (!factory) {
    return;
  }
  const load = `${DATABASE_PREFIX}${Date.now().toString(36)}:`;
  const open = factory.open.bind(factory);
  const deleteDatabase = factory.deleteDatabase.bind(factory);
  const databases = factory.databases?.bind(factory);
  const guardedOpen = (name: string, version?: number) =>
    open(isPreview(guardedOpen) ? `${load}${name}` : name, version);
  const guardedDelete = (name: string) =>
    deleteDatabase(isPreview(guardedDelete) ? `${load}${name}` : name);
  Object.assign(factory, { deleteDatabase: guardedDelete, open: guardedOpen });
  if (databases) {
    const guardedDatabases = async () => {
      const preview = isPreview(guardedDatabases);
      const all = await databases();
      return preview
        ? all
            .filter((d) => d.name?.startsWith(load))
            .map((d) => ({ ...d, name: d.name?.slice(load.length) }))
        : all.filter((d) => !d.name?.startsWith(DATABASE_PREFIX));
    };
    factory.databases = guardedDatabases;
    // The last loads' databases: what they stored is not this load's.
    databases()
      .then((all) => {
        for (const { name } of all) {
          if (name?.startsWith(DATABASE_PREFIX) && !name.startsWith(load)) {
            deleteDatabase(name);
          }
        }
      })
      .catch(() => undefined);
  }
};
