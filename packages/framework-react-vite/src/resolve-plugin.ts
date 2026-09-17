import path from "node:path";

export interface ResolvePluginOptions {
  /** Package whose dependencies the screens may import. Absolute. */
  anchorDir: string;
  /** Directories whose files resolve bare imports from the anchor. Absolute. */
  from: string[];
}

const BARE_RE = /^(?![./\\]|[A-Za-z]:[\\/])[^\0]/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;

/** A file that need not exist: only its directory matters to the resolver. */
const ANCHOR_FILE = "__ultrapaint_anchor__.ts";

interface Resolved {
  id: string;
}

interface DepsOptimizer {
  getOptimizedDepId: (info: unknown) => string;
  isOptimizedDepFile: (id: string) => boolean;
  options: { exclude?: string[]; noDiscovery?: boolean };
  registerMissingImport: (id: string, resolved: string) => unknown;
}

interface ResolveContext {
  environment?: { depsOptimizer?: DepsOptimizer };
  resolve: (
    source: string,
    importer?: string,
    options?: Record<string, unknown>
  ) => Promise<Resolved | null>;
}

const JS_FILE_RE = /\.[cm]?js$/;
const QUERY_RE = /\?.*$/;

/**
 * Vite pre-bundles a dependency the first time a source file imports it. A resolution asked
 * for by a plugin, as ours is, does not count as that first import (Vite 8), so a CommonJS
 * package such as React would reach the browser as it is. This registers the dependency the
 * way Vite's own resolver does for an ordinary import.
 */
const prebundled = (
  context: ResolveContext,
  source: string,
  resolved: Resolved
): Resolved => {
  const optimizer = context.environment?.depsOptimizer;
  const file = resolved.id.replace(QUERY_RE, "");
  const skip =
    !optimizer ||
    optimizer.options.noDiscovery ||
    optimizer.isOptimizedDepFile(file) ||
    !(NODE_MODULES_RE.test(file) && JS_FILE_RE.test(file)) ||
    optimizer.options.exclude?.some(
      (name) => source === name || source.startsWith(`${name}/`)
    );
  return skip
    ? resolved
    : {
        ...resolved,
        id: optimizer.getOptimizedDepId(
          optimizer.registerMissingImport(source, file)
        ),
      };
};

/**
 * Screens are files of no package: nothing is installed for them. This plugin resolves their
 * bare imports as if they were files of the anchor package, which already depends on React
 * and the design system. Only that first hop is redirected; once an import has landed in the
 * anchor's `node_modules`, everything below it resolves the ordinary way. Keeping one copy of
 * React on the page is Vite's own `resolve.dedupe`, with the anchor as the root.
 */
export const ultrapaintResolve = (options: ResolvePluginOptions) => {
  const anchorImporter = path.join(options.anchorDir, ANCHOR_FILE);
  const from = options.from.map((dir) => path.resolve(dir) + path.sep);

  return {
    enforce: "pre" as const,
    name: "ultrapaint:resolve",
    async resolveId(
      this: ResolveContext,
      source: string,
      importer: string | undefined,
      resolveOptions: Record<string, unknown>
    ) {
      if (!BARE_RE.test(source) || source.startsWith("\0")) {
        return null;
      }
      // No importer: an entry, or a dependency named in `optimizeDeps.include`. Vite would
      // look for it from the generated root, where nothing is installed.
      const file = importer
        ? path.resolve(importer.split("?")[0] ?? importer)
        : null;
      const ours =
        file === null ||
        (!NODE_MODULES_RE.test(file) &&
          from.some((dir) => file.startsWith(dir)));
      if (!ours || file === anchorImporter) {
        return null;
      }
      const resolved = await this.resolve(source, anchorImporter, {
        ...resolveOptions,
        skipSelf: true,
      });
      if (!resolved) {
        // Not found from the anchor: leave it to the ordinary resolution from the importer.
        return null;
      }
      return resolveOptions.scan
        ? resolved
        : prebundled(this, source, resolved);
    },
  };
};
