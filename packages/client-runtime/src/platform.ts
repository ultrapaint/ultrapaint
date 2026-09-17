/**
 * Host platform integration. The browser build has none; the desktop shell installs its own
 * implementation before the app boots. The editor never imports Electron directly.
 */
export interface Platform {
  readonly kind: "browser" | "desktop";
  /** Opens a native folder picker and resolves with the chosen absolute path, or null. */
  pickFolder?: () => Promise<string | null>;
  /** Base URL of the backend; undefined means same origin. */
  serverUrl?: string;
}

declare global {
  interface Window {
    ultrapaintPlatform?: Platform;
  }
}

export const getPlatform = (): Platform =>
  (typeof window !== "undefined" && window.ultrapaintPlatform) || {
    kind: "browser",
  };
