/**
 * The frames that froze the editor, kept in IndexedDB: the watchdog's thread writes them while
 * the editor's is stopped, the editor reads them when it loads again. By project, so another
 * project's frame of the same name is not held back.
 */

/** What the editor tells the watchdog's thread. */
export type WatchdogMessage =
  | { readonly type: "beat" }
  | { readonly project: string; readonly type: "project" }
  | {
      readonly frame: string;
      /** How long the frame's page code may still be running. */
      readonly forMs: number;
      readonly type: "suspect";
    };

const DB = "ultrapaint-watchdog";
const STORE = "frozen";
const SEPARATOR = "\n";

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const inStore = <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
) =>
  open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          reject(request.error);
          db.close();
        };
      })
  );

const keyOf = (project: string, frame: string) =>
  `${project}${SEPARATOR}${frame}`;

/** A frame that froze the editor: when, and where its page was stuck when the shell could tell. */
export interface Frozen {
  readonly at?: string;
  readonly frame: string;
  readonly time: number;
}

/** What is kept for a frame: when it froze the editor, or that and where. */
type Kept = number | { readonly at: string; readonly time: number };

export const addFrozen = (project: string, frame: string) =>
  inStore("readwrite", (store) => store.put(Date.now(), keyOf(project, frame)));

/** Writes down where `frozen`'s page was stuck, as the shell read it. */
export const addStoppedAt = (project: string, frozen: Frozen, at: string) =>
  inStore("readwrite", (store) =>
    store.put(
      { at, time: frozen.time } satisfies Kept,
      keyOf(project, frozen.frame)
    )
  );

export const removeFrozen = (project: string, frame: string) =>
  inStore("readwrite", (store) => store.delete(keyOf(project, frame)));

/** Every key and its value, read at once: the watchdog's thread may write meanwhile. */
const entries = () =>
  open().then(
    (db) =>
      new Promise<[IDBValidKey[], Kept[]]>((resolve, reject) => {
        const store = db.transaction(STORE, "readonly").objectStore(STORE);
        const keys = store.getAllKeys();
        const values = store.getAll();
        // A transaction's requests succeed in the order they were made.
        values.onsuccess = () => {
          resolve([keys.result, values.result as Kept[]]);
          db.close();
        };
        const failed = () => {
          reject(keys.error ?? values.error);
          db.close();
        };
        keys.onerror = failed;
        values.onerror = failed;
      })
  );

/** The frames of `project` that froze the editor and were not drawn anyway since. */
export const frozenFrames = async (project: string): Promise<Frozen[]> => {
  const [keys, values] = await entries();
  const prefix = keyOf(project, "");
  return keys.flatMap((key, i) => {
    const kept = values[i];
    if (!(String(key).startsWith(prefix) && kept !== undefined)) {
      return [];
    }
    const frame = String(key).slice(prefix.length);
    return [
      typeof kept === "number" ? { frame, time: kept } : { ...kept, frame },
    ];
  });
};
