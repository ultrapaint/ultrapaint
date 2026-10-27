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
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ASSET_PATH, resolveAsset } from "./asset-route.ts";
import {
  GUARD_ID,
  GUARD_MODULE,
  guardCode,
  MAY_GUARD_RE,
} from "./guard-code.ts";
import {
  flattenPlugins,
  has,
  REACT_PLUGIN_RE,
  sparing,
  splitPlugins,
  TAILWIND_PLUGIN_RE,
} from "./inherit-plugins.ts";
import { proxyUnder } from "./proxy.ts";
import { PUBLIC_FILES_ID, prefixPublicUrls } from "./public-urls.ts";
import { ultrapaintResolve } from "./resolve-plugin.ts";
import { CLIENT_RE, CLIENT_STYLES_HOOK, patchClient } from "./vite-client.ts";

export interface ServeOptions {
  anchorDir: string;
  /**
   * The path everything is served under, `/preview/`: the editor's server forwards it here, so
   * the editor imports the preview's modules from its own origin.
   */
  base: string;
  /** Directory of our browser bundles, outside the repository. */
  bundleDir: string;
  designsDir: string;
  /** The generated directory: the editor's entry module and the dependency cache. */
  dir: string;
  /** Every file that may be rendered, as glob patterns, for dependency discovery. */
  entries: string[];
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
  include: given.include.map(real),
  root: real(given.root),
};
const port = Number(portArg);
const fromAnchor = createRequire(path.join(options.anchorDir, "package.json"));

const log = (text: string) => console.log(`[ultrapaint] ${text}`);

const posix = (p: string) => p.replaceAll("\\", "/");
/**
 * Modules the anchor's plugins have nothing to do to: our browser bundles, built already, and the
 * dependencies Vite has bundled. An application's Babel setup runs on every module otherwise, and
 * spent seconds on them each time the preview started.
 */
const sparedRoots = [options.bundleDir, path.join(options.dir, ".vite")].map(
  (dir) => `${posix(dir)}/`
);
const spared = (id: string) =>
  sparedRoots.some((root) => posix(id).startsWith(root));

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
    plugins: sparing(kept, spared) as UserConfig["plugins"],
    publicDir:
      typeof config.publicDir === "string"
        ? path.resolve(config.root ?? options.anchorDir, config.publicDir)
        : config.publicDir,
    resolve: {
      alias: config.resolve?.alias,
      conditions: config.resolve?.conditions,
    },
    // What the application asks its own origin for reaches its backend as in `vite dev`: the
    // editor's page sends it under the base (`preview-core/requests.ts`).
    server: { proxy: proxyUnder(config.server?.proxy, options.base) },
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

const patchedClient = {
  enforce: "post" as const,
  name: "ultrapaint:client",
  transform(code: string, id: string) {
    if (!CLIENT_RE.test(id.split("?")[0] ?? id)) {
      return null;
    }
    const patched = patchClient(code);
    if (!patched.includes(CLIENT_STYLES_HOOK)) {
      log(
        "this Vite's client could not be adapted to the editor: a full reload reloads the editor"
      );
    }
    return { code: patched, map: null };
  },
};

/** The application's code, where a root path to one of its public files can be written. */
const CODE_RE = /\.(?:[cm]?[jt]sx?|json)$/;

/** Root paths to the public directory's files, under the base the editor's page finds them at. */
const publicUrls = () => {
  let publicDir = "";
  let base = "/";
  const stat = (relative: string) =>
    statSync(path.join(publicDir, relative), { throwIfNoEntry: false });
  const files = {
    isDirectory: (relative: string) => stat(relative)?.isDirectory() === true,
    isFile: (relative: string) => stat(relative)?.isFile() === true,
  };
  return {
    configResolved(config: import("vite").ResolvedConfig) {
      ({ base, publicDir } = config);
    },
    enforce: "post" as const,
    load(id: string) {
      if (id !== `\0${PUBLIC_FILES_ID}`) {
        return null;
      }
      const entries =
        publicDir !== "" && existsSync(publicDir)
          ? readdirSync(publicDir, { withFileTypes: true }).map((entry) =>
              entry.isDirectory() ? `${entry.name}/` : entry.name
            )
          : [];
      return `export const publicFiles = ${JSON.stringify({ base, entries })};`;
    },
    name: "ultrapaint:public-urls",
    resolveId(id: string) {
      return id === PUBLIC_FILES_ID ? `\0${PUBLIC_FILES_ID}` : null;
    },
    transform(code: string, id: string) {
      const file = id.split("?")[0] ?? id;
      if (
        publicDir === "" ||
        id.startsWith("\0") ||
        file.includes("/node_modules/") ||
        !CODE_RE.test(file)
      ) {
        return null;
      }
      const next = prefixPublicUrls(code, base, files);
      return next === null ? null : { code: next, map: null };
    },
  };
};

/** Modules the guard is put in: the repository's own code, not its dependencies or ours. */
const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The repository's loops checked and its `async` functions marking what they reject
 * (`guard-code.ts`): after every other plugin, on JavaScript.
 */
const guardedCode = () => {
  let loops = 0;
  const nextId = () => {
    loops += 1;
    return loops;
  };
  const ours = [options.dir, options.bundleDir].map((d) => posix(`${d}/`));
  return {
    enforce: "post" as const,
    load(id: string) {
      return id === `\0${GUARD_ID}` ? GUARD_MODULE : null;
    },
    name: "ultrapaint:guard",
    resolveId(id: string) {
      return id === GUARD_ID ? `\0${GUARD_ID}` : null;
    },
    transform(
      this: { parse: (code: string) => unknown },
      code: string,
      id: string
    ) {
      const file = posix(id.split("?")[0] ?? id);
      if (
        id.startsWith("\0") ||
        file.includes("/node_modules/") ||
        !SOURCE_RE.test(file) ||
        ours.some((d) => file.startsWith(d))
      ) {
        return null;
      }
      let program: unknown = null;
      if (MAY_GUARD_RE.test(code)) {
        try {
          program = this.parse(code);
        } catch {
          // Not JavaScript Vite's parser reads: its loops are left as they are.
        }
      }
      const next = guardCode(code, program, nextId);
      return next === null ? null : { code: next, map: null };
    },
  };
};

const MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

/**
 * An image of a canvas, found where it is and sent from here. A redirect to the file was a round
 * trip of its own for every image of every page loaded, which the browser does not keep; the file
 * is checked again by its size and time, and answered with 304 when it did not change.
 */
const serveAsset = {
  configureServer(dev: import("vite").ViteDevServer) {
    dev.middlewares.use(
      `${options.base.slice(0, -1)}${ASSET_PATH}`,
      (req, res) => {
        const params = new URL(req.url ?? "/", "http://preview").searchParams;
        const file = resolveAsset(
          options.designsDir,
          params.get("canvas") ?? "",
          params.get("src") ?? "",
          existsSync
        );
        if (file === null) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const stat = statSync(file);
        const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        res.setHeader("cache-control", "no-cache");
        res.setHeader("etag", etag);
        if (req.headers["if-none-match"] === etag) {
          res.statusCode = 304;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader(
          "content-type",
          MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream"
        );
        res.setHeader("content-length", stat.size);
        createReadStream(file).pipe(res);
      }
    );
  },
  name: "ultrapaint:assets",
};

const server = await vite.createServer(
  vite.mergeConfig(inherited, {
    appType: "custom",
    base: options.base,
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
        // The generated modules sit outside the repository: what they import resolves from the
        // anchor, `#` imports and aliases included.
        from: [options.designsDir, options.bundleDir, options.dir],
      }),
      serveAsset,
      patchedClient,
      publicUrls(),
      guardedCode(),
      ...(sparing(
        await flattenPlugins(extra),
        spared
      ) as import("vite").PluginOption[]),
    ],
    resolve: { dedupe: options.singletons },
    // The anchor package is the Vite root, as the project directory is for Storybook: what Vite
    // resolves on its own account (pre-bundled dependencies, de-duplicated packages, the public
    // directory, env files) comes from where the design system's consumers get it. The modules
    // the editor imports are served from the generated directory, outside it.
    root: options.anchorDir,
    server: {
      // The client runs in the editor's page: what that page logs is the editor's, not the
      // preview's, and Vite reads the stacks of what it is sent against its own modules.
      forwardConsole: false,
      fs: { allow: [options.root, options.bundleDir, options.dir] },
      // No address of its own: the client reaches the socket where it was loaded from, the
      // editor's server, which forwards it here. Errors are the editor's to show.
      hmr: { overlay: false },
      host,
      port,
      strictPort: true,
      // The page's own modules are transformed as the server starts, not when the first
      // preview asks for them.
      warmup: {
        clientFiles: [
          path.join(options.dir, "editor.ts"),
          path.join(options.dir, "components.ts"),
        ],
      },
    },
  } satisfies InlineConfig)
);
// Vite watches its root, the anchor package. The pages and the design system's sources lie
// outside it, so a page added after the start would never reach `import.meta.glob` in the entry
// module: the canvas lists it and the preview answers that there is no page for its route.
server.watcher.add([...options.include, options.dir]);
await server.listen();
server.printUrls();

const stop = () =>
  server.close().then(
    () => process.exit(0),
    () => process.exit(0)
  );
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
