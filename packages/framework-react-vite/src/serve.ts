/**
 * Serves the preview. Run by the server as a child process from the anchor package:
 * `node serve.mjs <options.json> <port> [host]`. The host is loopback unless given; `0.0.0.0`
 * or `::` listen on every interface.
 *
 * Like Storybook's Vite builder it uses the repository's own Vite and the anchor's
 * `vite.config`, so aliases, CSS tooling and the React plugin's options are the ones the
 * design system is built with. A repository without Vite gets the copy bundled with this
 * package. Plugins that turn a dev server into an application server are left out.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  flattenPlugins,
  has,
  REACT_PLUGIN_RE,
  splitPlugins,
  TAILWIND_PLUGIN_RE,
} from "./inherit-plugins.ts";
import { ultrapaintResolve } from "./resolve-plugin.ts";

export interface ServeOptions {
  anchorDir: string;
  /** Directory of our browser bundles, outside the repository. */
  bundleDir: string;
  designsDir: string;
  /** The generated directory: the page, its entry module and the dependency cache. */
  dir: string;
  /** Every file that may be rendered, as glob patterns, for dependency discovery. */
  entries: string[];
  /** The generated page, served at `/`. */
  html: string;
  /** Directories the dev server watches beyond its root: the designs and the libraries. */
  include: string[];
  root: string;
  /** Packages there must be one copy of on the page: resolved from the anchor for everyone. */
  singletons: string[];
  /** Whether the anchor has Tailwind's Vite plugin. */
  tailwind: boolean;
}

const [optionsFile, portArg, hostArg] = process.argv.slice(2);
const host = hostArg || "127.0.0.1";
// Bound to every interface, the HMR client is left to use the address the page was loaded at.
const hmr = host === "0.0.0.0" || host === "::" ? {} : { host };
const given = JSON.parse(
  readFileSync(optionsFile as string, "utf8")
) as ServeOptions;
// The bundler reports real paths; a directory reached through a symlink must compare equal.
const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
const options: ServeOptions = {
  ...given,
  anchorDir: real(given.anchorDir),
  bundleDir: real(given.bundleDir),
  designsDir: real(given.designsDir),
  dir: real(given.dir),
  html: real(given.html),
  include: given.include.map(real),
  root: real(given.root),
};
const port = Number(portArg);
const fromAnchor = createRequire(path.join(options.anchorDir, "package.json"));

const log = (text: string) => console.log(`[ultrapaint] ${text}`);

/**
 * Root directory of a package as the anchor resolves it, or null. Looked up by folder instead
 * of `require.resolve`: that fails for a package with no CommonJS entry, and an aliased
 * package (`"vite": "npm:..."`) carries another name in its own manifest.
 */
const packageDir = (id: string): string | null => {
  for (const modules of fromAnchor.resolve.paths(id) ?? []) {
    const dir = path.join(modules, id);
    if (existsSync(path.join(dir, "package.json"))) {
      return realpathSync(dir);
    }
  }
  return null;
};

interface Manifest {
  exports?: Record<string, unknown> | string;
  main?: string;
  module?: string;
}

/** The ESM entry of a package: `require.resolve` alone would pick the CommonJS one. */
const esmEntry = (dir: string): string => {
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8")
  ) as Manifest;
  const pick = (value: unknown): string | null => {
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object") {
      const conditions = value as Record<string, unknown>;
      return (
        pick(conditions.import) ??
        pick(conditions["module-sync"]) ??
        pick(conditions.default)
      );
    }
    return null;
  };
  const root =
    typeof manifest.exports === "object" && "." in manifest.exports
      ? manifest.exports["."]
      : manifest.exports;
  return path.join(
    dir,
    pick(root) ?? manifest.module ?? manifest.main ?? "index.js"
  );
};

/** The repository's copy when the anchor can resolve one, the bundled copy otherwise. */
const load = async <T>(id: string): Promise<{ module: T; own: boolean }> => {
  const dir = packageDir(id);
  if (dir) {
    return {
      module: (await import(pathToFileURL(esmEntry(dir)).href)) as T,
      own: false,
    };
  }
  return { module: (await import(id)) as T, own: true };
};

type Vite = typeof import("vite");
type UserConfig = import("vite").UserConfig;
type InlineConfig = import("vite").InlineConfig;

/** What a preview of single screens can take over from the anchor's own Vite config. */
const inheritedConfig = async (api: Vite): Promise<UserConfig> => {
  let loaded: Awaited<ReturnType<Vite["loadConfigFromFile"]>> = null;
  try {
    loaded = await api.loadConfigFromFile(
      { command: "serve", mode: "development" },
      undefined,
      options.anchorDir
    );
  } catch (error) {
    // An application's config often needs its environment to load. The preview works
    // without it; only aliases and plugins declared there are then missing.
    log(
      `could not load the Vite config of ${options.anchorDir}, continuing without it: ${(error as Error).message}`
    );
  }
  if (!loaded) {
    return {};
  }
  const { config } = loaded;
  const { dropped, kept } = splitPlugins(await flattenPlugins(config.plugins));
  log(`using ${loaded.path}`);
  if (dropped.length > 0) {
    log(
      `left out plugins that belong to the application: ${dropped.join(", ")}`
    );
  }
  return {
    css: config.css,
    define: config.define,
    envDir: config.envDir,
    envPrefix: config.envPrefix,
    optimizeDeps: {
      exclude: config.optimizeDeps?.exclude,
      include: config.optimizeDeps?.include,
    },
    plugins: kept as UserConfig["plugins"],
    publicDir:
      typeof config.publicDir === "string"
        ? path.resolve(config.root ?? options.anchorDir, config.publicDir)
        : config.publicDir,
    resolve: {
      alias: config.resolve?.alias,
      conditions: config.resolve?.conditions,
    },
  };
};

if (!packageDir("react")) {
  console.error(
    `react cannot be resolved from ${options.anchorDir}. In the settings, set "Resolve imports from" to a package of the repository that depends on react and the design system.`
  );
  process.exit(1);
}

const { module: vite, own: ownVite } = await load<Vite>("vite");
log(ownVite ? "using the bundled Vite" : "using the repository's Vite");

const inherited = await inheritedConfig(vite);
const inheritedPlugins = await flattenPlugins(inherited.plugins);
const extra: import("vite").PluginOption[] = [];
if (!has(inheritedPlugins, REACT_PLUGIN_RE)) {
  const { module } = await load<{
    default: () => import("vite").PluginOption;
  }>("@vitejs/plugin-react");
  extra.push(module.default());
}
if (options.tailwind && !has(inheritedPlugins, TAILWIND_PLUGIN_RE)) {
  const { module } = await load<{
    default: () => import("vite").PluginOption;
  }>("@tailwindcss/vite");
  extra.push(module.default());
}

/**
 * The anchor package is the Vite root, as the project directory is for Storybook: what Vite
 * resolves on its own account (pre-bundled dependencies, de-duplicated packages, the public
 * directory, env files) then comes from where the design system's consumers get it. Our page
 * is not a file of that package, so it is served from the generated directory.
 */
const servePage = {
  configureServer(dev: import("vite").ViteDevServer) {
    dev.middlewares.use((req, res, next) => {
      const url = req.url ?? "/";
      const [pathname] = url.split("?");
      if (pathname !== "/" && pathname !== "/index.html") {
        next();
        return;
      }
      dev
        .transformIndexHtml(url, readFileSync(options.html, "utf8"))
        .then((html) => {
          res.statusCode = 200;
          res.setHeader("content-type", "text/html");
          res.end(html);
        }, next);
    });
  },
  name: "ultrapaint:page",
};

const server = await vite.createServer(
  vite.mergeConfig(inherited, {
    appType: "spa",
    cacheDir: path.join(options.dir, ".vite"),
    clearScreen: false,
    configFile: false,
    // A PostCSS setup (Tailwind 3) is looked for from the anchor, not from the generated root.
    css: inherited.css?.postcss ? {} : { postcss: options.anchorDir },
    logLevel: "info",
    // Scan the registry and every design-system file up front so Vite pre-bundles all
    // dependencies once; discovering a new dependency later re-optimises and can load a second
    // React copy.
    optimizeDeps: { entries: options.entries },
    plugins: [
      ultrapaintResolve({
        anchorDir: options.anchorDir,
        from: [options.designsDir, options.bundleDir],
      }),
      servePage,
      ...extra,
    ],
    resolve: { dedupe: options.singletons },
    root: options.anchorDir,
    server: {
      fs: { allow: [options.root, options.bundleDir] },
      hmr,
      host,
      port,
      strictPort: true,
      watch: { ignored: ["**/.ultrapaint/.vite/**"] },
    },
  } satisfies InlineConfig)
);
// Vite watches its root, the anchor package. The pages and the design system's sources lie
// outside it, so a page added after the start would never reach `import.meta.glob` in the entry
// module: the canvas lists it and the preview answers that there is no page for its route.
server.watcher.add(options.include);
await server.listen();
server.printUrls();

const stop = () =>
  server.close().then(
    () => process.exit(0),
    () => process.exit(0)
  );
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
