/**
 * What a module of the repository leaves behind when Vite replaces it
 * (docs/PLAN-preview-sandbox.md, step 14). The editor's page is never loaded again for an edit:
 * a module's top-level code that adds a listener to the window or starts an interval ran again at
 * every update, and each version's stayed, four deep after three edits. React takes back what an
 * effect added; nothing took back what a module's own code did.
 *
 * The preview's server marks where each module's top-level code starts and ends
 * (`guard-code.ts`). What is added to the window while it runs is that version's; when a newer
 * version of the same module starts (Vite imports it again under `?t=`), the older versions' are
 * taken off before it runs.
 */

interface Added {
  readonly remove: () => void;
  readonly version: number;
}

/** The module whose top-level code runs: its path and its version. */
let running: { readonly path: string; readonly version: number } | null = null;
/** The newest version of each module that ran. */
const newest = new Map<string, number>();
const added = new Map<string, Added[]>();

/** A module's address as its path under the server and its version (`?t=`, 0 before any). */
const versionOf = (url: string) => {
  const parsed = new URL(url, location.href);
  return {
    path: parsed.pathname,
    version: Number(parsed.searchParams.get("t") ?? 0) || 0,
  };
};

/** The module at `url` starts its top-level code: what older versions of it added goes. */
export const moduleStarts = (url: string) => {
  const { path, version } = versionOf(url);
  const before = newest.get(path);
  if (before === undefined || version > before) {
    newest.set(path, version);
    const kept: Added[] = [];
    for (const entry of added.get(path) ?? []) {
      if (entry.version < version) {
        entry.remove();
      } else {
        kept.push(entry);
      }
    }
    added.set(path, kept);
  }
  running = { path, version };
  // A module that awaits at its top level lets other code run: that code is not its.
  queueMicrotask(() => {
    if (running?.path === path) {
      running = null;
    }
  });
};

/** The module at `url` ran its top-level code to the end. */
export const moduleEnds = (url: string) => {
  if (running?.path === versionOf(url).path) {
    running = null;
  }
};

/** Something was just added to the window; `remove` takes it off. Kept if a module's code runs. */
export const addedNow = (remove: () => void) => {
  if (!running) {
    return;
  }
  const { path, version } = running;
  const list = added.get(path) ?? [];
  list.push({ remove, version });
  added.set(path, list);
};
