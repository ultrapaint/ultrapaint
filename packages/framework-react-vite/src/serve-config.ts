/**
 * The preview server's Vite config, built from the serve script's options and a loaded Vite
 * (`serve.ts` reads the options, loads Vite, listens and stops).
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
import type {
  InlineConfig,
  Plugin,
  PluginOption,
  ResolvedConfig,
  UserConfig,
  ViteDevServer,
} from "vite";
import { ASSET_PATH, resolveAsset } from "./asset-route.ts";
import {
  GUARD_ID,
  GUARD_MODULE,
  guardCode,
  guardedKind,
  MAY_GUARD_RE,
  MAY_LOOP_RE,
} from "./guard-code.ts";
import {
  flattenPlugins,
  has,
  REACT_PLUGIN_RE,
  sparing,
  splitPlugins,
  TAILWIND_PLUGIN_RE,
} from "./inherit-plugins.ts";
import { COMPONENTS_FILE, EDITOR_FILE, SETUP_FILE } from "./preview-files.ts";
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

/** The bundler reports real paths; a directory reached through a symlink must compare equal. */
export const realOptions = (given: ServeOptions): ServeOptions => {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
  return {
    ...given,
    anchorDir: real(given.anchorDir),
    bundleDir: real(given.bundleDir),
    designsDir: real(given.designsDir),
    dir: real(given.dir),
    include: given.include.map(real),
    root: real(given.root),
  };
};

export type Vite = typeof import("vite");

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

/** The packages the anchor resolves: the repository's Vite and plugins rather than ours. */
export const anchorModules = (anchorDir: string) => {
  const fromAnchor = createRequire(path.join(anchorDir, "package.json"));
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
  return { load, resolves: (id: string) => packageDir(id) !== null };
};

const posix = (p: string) => p.replaceAll("\\", "/");

/** What a preview of single screens can take over from the anchor's own Vite config. */
const inheritedConfig = async (
  vite: Vite,
  options: ServeOptions,
  spared: (id: string) => boolean,
  log: (text: string) => void
): Promise<UserConfig> => {
  let loaded: Awaited<ReturnType<Vite["loadConfigFromFile"]>> = null;
  try {
    loaded = await vite.loadConfigFromFile(
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

/** Vite's client, patched to ask the editor's page how to reload and where styles go. */
const patchedClient = (log: (text: string) => void): Plugin => ({
  enforce: "post",
  name: "ultrapaint:client",
  transform(code, id) {
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
});

/** The application's code, where a root path to one of its public files can be written. */
const CODE_RE = /\.(?:[cm]?[jt]sx?|json)$/;

/** Root paths to the public directory's files, under the base the editor's page finds them at. */
const publicUrls = (): Plugin => {
  let publicDir = "";
  let base = "/";
  const stat = (relative: string) =>
    statSync(path.join(publicDir, relative), { throwIfNoEntry: false });
  const files = {
    isDirectory: (relative: string) => stat(relative)?.isDirectory() === true,
    isFile: (relative: string) => stat(relative)?.isFile() === true,
  };
  return {
    configResolved(config: ResolvedConfig) {
      ({ base, publicDir } = config);
    },
    enforce: "post",
    load(id) {
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
    resolveId(id) {
      return id === PUBLIC_FILES_ID ? `\0${PUBLIC_FILES_ID}` : null;
    },
    transform(code, id) {
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

/**
 * The repository's loops checked, its `async` functions marking what they reject and its modules
 * saying where their top-level code runs; its dependencies' loops checked too (`guard-code.ts`):
 * after every other plugin, on JavaScript. `ours` are the editor's directories (the generated
 * modules and our bundles, each ending in `/`), never guarded.
 */
const guardedCode = (ours: readonly string[]): Plugin => {
  let loops = 0;
  const nextId = () => {
    loops += 1;
    return loops;
  };
  return {
    enforce: "post",
    load(id) {
      return id === `\0${GUARD_ID}` ? GUARD_MODULE : null;
    },
    name: "ultrapaint:guard",
    resolveId(id) {
      return id === GUARD_ID ? `\0${GUARD_ID}` : null;
    },
    transform(code, id) {
      const kind = guardedKind(id, ours);
      if (kind === null) {
        return null;
      }
      const dependency = kind === "dependency";
      let program: unknown = null;
      if ((dependency ? MAY_LOOP_RE : MAY_GUARD_RE).test(code)) {
        try {
          program = this.parse(code);
        } catch {
          // Not JavaScript Vite's parser reads: its loops are left as they are.
        }
      }
      // A dependency's loops are numbered 0: they never throw at once (`guard-code.ts`).
      const next = guardCode(
        code,
        program,
        dependency ? () => 0 : nextId,
        dependency ? { markAsync: false, markModule: false } : {}
      );
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
const serveAsset = (options: ServeOptions): Plugin => ({
  configureServer(dev: ViteDevServer) {
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
});

export interface ServeConfigInput {
  readonly host: string;
  readonly log: (text: string) => void;
  /** Real paths (`realOptions`): the bundler reports real paths. */
  readonly options: ServeOptions;
  readonly port: number;
  /** The Vite the server is created with: the repository's, or ours. */
  readonly vite: Vite;
}

export interface ServeConfig {
  readonly config: InlineConfig;
  /** What the server watches beyond its root, once created. */
  readonly watch: readonly string[];
}

/**
 * The preview server's Vite config: what it takes from the anchor's own, the plugins in their
 * order (the anchor's resolution, the canvas's images, the patched client, public URLs, the
 * guard, then React's and Tailwind's when the anchor lacks them), and where it serves from.
 */
export const serveConfig = async ({
  host,
  log,
  options,
  port,
  vite,
}: ServeConfigInput): Promise<ServeConfig> => {
  /**
   * Modules the anchor's plugins have nothing to do to: our browser bundles, built already, and
   * the dependencies Vite has bundled. An application's Babel setup runs on every module
   * otherwise, and spent seconds on them each time the preview started.
   */
  const sparedRoots = [options.bundleDir, path.join(options.dir, ".vite")].map(
    (dir) => `${posix(dir)}/`
  );
  const spared = (id: string) =>
    sparedRoots.some((root) => posix(id).startsWith(root));

  const inherited = await inheritedConfig(vite, options, spared, log);
  const inheritedPlugins = await flattenPlugins(inherited.plugins);
  const { load } = anchorModules(options.anchorDir);
  const extra: PluginOption[] = [];
  if (!has(inheritedPlugins, REACT_PLUGIN_RE)) {
    const { module } = await load<{ default: () => PluginOption }>(
      "@vitejs/plugin-react"
    );
    extra.push(module.default());
  }
  if (options.tailwind && !has(inheritedPlugins, TAILWIND_PLUGIN_RE)) {
    const { module } = await load<{ default: () => PluginOption }>(
      "@tailwindcss/vite"
    );
    extra.push(module.default());
  }

  const config = vite.mergeConfig(inherited, {
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
      serveAsset(options),
      patchedClient(log),
      publicUrls(),
      // The generated modules and our bundles: the editor's, never guarded.
      guardedCode([options.dir, options.bundleDir].map((d) => posix(`${d}/`))),
      ...(sparing(await flattenPlugins(extra), spared) as PluginOption[]),
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
          path.join(options.dir, EDITOR_FILE),
          path.join(options.dir, SETUP_FILE),
          path.join(options.dir, COMPONENTS_FILE),
        ],
      },
    },
  } satisfies InlineConfig);
  // Vite watches its root, the anchor package. The pages and the design system's sources lie
  // outside it, so a page added after the start would never reach `import.meta.glob` in the
  // entry module: the canvas lists it and the preview answers that there is no page for its
  // route.
  return { config, watch: [...options.include, options.dir] };
};
