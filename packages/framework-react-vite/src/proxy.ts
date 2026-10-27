/**
 * The repository's own `server.proxy`, moved under the preview's base (docs/PLAN-preview-sandbox.md,
 * step 8). The preview's code asks the editor's origin for `/api/products`; the editor's page sends
 * that under the base (`/preview/api/products`), to the preview's server, which forwards it as the
 * repository's `vite dev` would have, the base taken off again.
 */
import type { ProxyOptions } from "vite";

type Proxy = Record<string, string | ProxyOptions>;

const TRAILING_SLASH_RE = /\/$/;

/** `proxy` keyed under `base` (`/preview/`), each rule seeing the path without it. */
export const proxyUnder = (
  proxy: Proxy | undefined,
  base: string
): Proxy | undefined => {
  if (!proxy || base === "/") {
    return proxy;
  }
  const prefix = base.replace(TRAILING_SLASH_RE, "");
  const strip = (path: string) =>
    path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
  return Object.fromEntries(
    Object.entries(proxy).map(([key, value]) => {
      // A key opening on `^` is a regular expression, as Vite reads it.
      const under = key.startsWith("^")
        ? `^${prefix}${key.slice(1)}`
        : `${prefix}${key}`;
      const options: ProxyOptions =
        typeof value === "string"
          ? { changeOrigin: true, target: value }
          : value;
      const { rewrite } = options;
      return [
        under,
        {
          ...options,
          rewrite: (path: string) =>
            rewrite ? rewrite(strip(path)) : strip(path),
        },
      ];
    })
  );
};
