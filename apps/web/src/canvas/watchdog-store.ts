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

export const addFrozen = (project: string, frame: string) =>
  inStore("readwrite", (store) => store.put(Date.now(), keyOf(project, frame)));

export const removeFrozen = (project: string, frame: string) =>
  inStore("readwrite", (store) => store.delete(keyOf(project, frame)));

/** The frames of `project` that froze the editor and were not drawn anyway since. */
export const frozenFrames = async (project: string): Promise<string[]> => {
  const keys = await inStore("readonly", (store) => store.getAllKeys());
  const prefix = keyOf(project, "");
  return keys
    .map(String)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
};
