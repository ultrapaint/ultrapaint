/**
 * Host platform integration. The browser build has none: the editor is served by the backend
 * and talks to the origin it came from. A host that serves the editor from elsewhere sets
 * `window.ultrapaintPlatform` before the app boots.
 */
export interface Platform {
  /** Base URL of the backend; undefined means same origin. */
  serverUrl?: string;
}

declare global {
  interface Window {
    ultrapaintPlatform?: Platform;
  }
}

export const getPlatform = (): Platform =>
  (typeof window !== "undefined" && window.ultrapaintPlatform) || {};
