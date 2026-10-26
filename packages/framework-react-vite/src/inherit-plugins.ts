/** Which plugins of the anchor's own Vite config a preview of a canvas's pages can run. */

export interface NamedPlugin {
  name?: string;
}

// Plugins of an application's dev server that a preview of a canvas's pages must not run:
// server frameworks and their routers, deployment adapters, error reporting, build reports.
const DROPPED_PLUGIN_RE =
  /tanstack|react-router|remix|vike|vinxi|nitro|cloudflare|netlify|vercel|sentry|pwa|workbox|legacy|checker|inspect|visualizer|analyz|mkcert|basic-ssl|federation|storybook|vitest|devtools|validate-env|delete-source-?maps/i;

export const REACT_PLUGIN_RE = /^vite:react/;
export const TAILWIND_PLUGIN_RE = /^@tailwindcss\/vite/;

/** Vite accepts plugins nested in arrays, as promises, and as falsy placeholders. */
export const flattenPlugins = async (
  plugins: unknown
): Promise<NamedPlugin[]> => {
  const resolved = await plugins;
  if (Array.isArray(resolved)) {
    return (await Promise.all(resolved.map(flattenPlugins))).flat();
  }
  return resolved && typeof resolved === "object"
    ? [resolved as NamedPlugin]
    : [];
};

export const splitPlugins = (plugins: readonly NamedPlugin[]) => {
  const kept = plugins.filter((p) => !DROPPED_PLUGIN_RE.test(p.name ?? ""));
  return {
    dropped: plugins.filter((p) => !kept.includes(p)).map((p) => p.name ?? ""),
    kept,
  };
};

export const has = (plugins: readonly NamedPlugin[], re: RegExp) =>
  plugins.some((p) => re.test(p.name ?? ""));

type TransformHandler = (
  this: unknown,
  code: string,
  id: string,
  ...rest: unknown[]
) => unknown;

interface TransformingPlugin extends NamedPlugin {
  transform?: TransformHandler | { handler: TransformHandler };
}

/** A module id without its query: `/a/render.js?v=1` is `/a/render.js`. */
const pathOf = (id: string) => id.split("?")[0] ?? id;

/**
 * The plugins, each leaving alone the modules `spared` says: our own browser bundles, built
 * already, and the dependencies Vite has bundled. An application's Babel setup (React Compiler,
 * Lingui) often runs on every module, and spent seconds on them each time the preview started.
 */
export const sparing = <P extends NamedPlugin>(
  plugins: readonly P[],
  spared: (path: string) => boolean
): P[] =>
  plugins.map((plugin) => {
    const { transform } = plugin as TransformingPlugin;
    if (!transform) {
      return plugin;
    }
    const handler =
      typeof transform === "function" ? transform : transform.handler;
    const guarded: TransformHandler = function (code, id, ...rest) {
      return spared(pathOf(id)) ? null : handler.call(this, code, id, ...rest);
    };
    return {
      ...plugin,
      transform:
        typeof transform === "function"
          ? guarded
          : { ...transform, handler: guarded },
    };
  });
