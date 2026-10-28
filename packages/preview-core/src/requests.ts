/**
 * Where the preview's code sends its requests (docs/PLAN-preview-sandbox.md, step 8). An
 * application asks its own origin for `/api/products`; in the editor's page its origin is the
 * editor's, whose server has routes of its own under the same names. A request the preview's code
 * makes to the editor's origin goes under the preview's base instead, to the preview's server,
 * which forwards what the repository's own Vite config proxies (`server.proxy`) as `vite dev` does,
 * and answers anything else as it answers a file it does not have.
 *
 * `fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket` and `navigator.sendBeacon`. Whose call it is
 * is told by the whole stack (`provenance.ts`, `request`): an application that wraps `fetch` is
 * called by the editor too.
 */
import type { Provenance } from "./provenance.ts";

/** The function or class standing in for a native one: frames above it on a stack are its. */
type Patched = object;

const SCHEME_RE = /^(?:https?|wss?):$/;

/**
 * `url`, as `page` would read it, moved under `base` when it names the page's own host outside
 * it; null when it is left as it is: another site, a `data:` or `blob:` URL, or the preview's own.
 */
export const underPreview = (
  url: string | URL,
  base: string,
  page: string
): string | null => {
  if (base === "") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(String(url), page);
  } catch {
    // Not a URL: the request fails as it would have.
    return null;
  }
  if (
    !SCHEME_RE.test(parsed.protocol) ||
    parsed.host !== new URL(page).host ||
    parsed.pathname.startsWith(base) ||
    `${parsed.pathname}/` === base
  ) {
    return null;
  }
  parsed.pathname = `${base}${parsed.pathname.slice(1)}`;
  return parsed.href;
};

/** Puts the preview's requests under its base, once; `provenance` says whose call it is. */
export const guardRequests = (provenance: Provenance) => {
  /** Where `url` goes when `patched` was called by the preview's code; null when it goes as asked. */
  const moved = (url: string | URL, patched: Patched) => {
    const next = underPreview(url, provenance.base, location.href);
    return next !== null && provenance.request(patched) ? next : null;
  };

  const nativeFetch = window.fetch;
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const next = moved(input instanceof Request ? input.url : input, fetch);
    if (next === null) {
      return nativeFetch.call(window, input, init);
    }
    return nativeFetch.call(
      window,
      input instanceof Request ? new Request(next, input) : next,
      init
    );
  };
  window.fetch = fetch;

  const { open } = XMLHttpRequest.prototype;
  const guardedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (open as (...args: unknown[]) => void).call(
      this,
      method,
      moved(url, guardedOpen) ?? url,
      ...rest
    );
  };
  XMLHttpRequest.prototype.open = guardedOpen as typeof open;

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    class GuardedEventSource extends NativeEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(moved(url, GuardedEventSource) ?? url, init);
      }
    }
    window.EventSource = GuardedEventSource;
  }

  const NativeWebSocket = window.WebSocket;
  class GuardedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(moved(url, GuardedWebSocket) ?? url, protocols);
    }
  }
  window.WebSocket = GuardedWebSocket;

  if (typeof navigator.sendBeacon === "function") {
    const beacon = navigator.sendBeacon.bind(navigator);
    const guardedBeacon = (url: string | URL, data?: BodyInit | null) =>
      beacon(moved(url, guardedBeacon) ?? url, data);
    navigator.sendBeacon = guardedBeacon;
  }
};
