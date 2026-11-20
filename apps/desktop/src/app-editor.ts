/**
 * The desktop app's own copy of the editor (ADR 0100): served to the window under the app's
 * scheme, the same origin for every project, so its code is cached and its browser storage kept
 * from one open to the next. A project's server serves it data only, and allows this origin.
 */

/** The scheme the app serves its own pages under: the start page and the editor. */
export const APP_SCHEME = "ultrapaint";

/** Their origin, which every server the app starts allows (`--allowed-origin`). */
export const APP_ORIGIN = `${APP_SCHEME}://app`;

/** Where the app's editor is loaded from; it reaches its server at the bridge's `editorServer`. */
export const APP_EDITOR_URL = `${APP_ORIGIN}/`;

/** The app's own editor as `OpenProjects` shows it: where it loads, and the servers it talks to. */
export interface AppEditor {
  readonly url: string;
  /** The version of `ultrapaint` a server must run to be shown in it: the app's own. */
  readonly version: string;
}

/** The hosts of this machine the app's servers listen on, or are forwarded to over SSH. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Whether an address is one of the app's own pages, or a page of a server on this machine (an
 * editor a server serves itself, a project over SSH forwarded here): the only ones a view may
 * show, and call the bridge from.
 */
export const isAppPage = (address: string) => {
  try {
    const url = new URL(address);
    return (
      (url.protocol === `${APP_SCHEME}:` && url.host === "app") ||
      (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
    );
  } catch {
    // Not an address at all: none of the app's.
    return false;
  }
};
