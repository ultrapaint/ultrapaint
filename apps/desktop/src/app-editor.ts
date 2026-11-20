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

/**
 * The origin of an address, its scheme, host and port: the app's own scheme included, which
 * `URL.origin` gives as "null". Null for what is no address.
 */
export const originOf = (address: string): string | null => {
  try {
    const url = new URL(address);
    return url.host === "" ? null : `${url.protocol}//${url.host}`;
  } catch {
    // Not an address at all: no origin.
    return null;
  }
};

/**
 * Whether an address is on the origin the app gave a view: the app's own pages, or the one
 * server its project's editor is at. Any other, a service of this machine on another port
 * included, is not the view's to show, nor to call the bridge from.
 */
export const onOrigin = (address: string, assigned: string | undefined) =>
  assigned !== undefined && originOf(address) === assigned;
