import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// A source checkout builds the bundles on demand. A bundled server has no sources to build
// from: its build copies them next to it, into `preview/`.
const fromSource = import.meta.url.endsWith(".ts");
const dist = fromSource
  ? path.resolve(here, "../dist")
  : path.join(here, "preview");

export interface PreviewBundles {
  /** Directory of the browser bundles; the preview server is allowed to serve from it. */
  readonly dir: string;
  /** ES module with `renderToCanvas`; `react` stays an import, so it is the repository's. */
  readonly render: string;
  /** Classic script injected ahead of the screen: preview core plus React's introspector. */
  readonly runtime: string;
  /** Node script that serves the preview. */
  readonly serve: string;
}

const bundles: PreviewBundles = {
  dir: dist,
  render: path.join(dist, "render.js"),
  runtime: path.join(dist, "runtime.js"),
  serve: path.join(dist, "serve.mjs"),
};

const newest = (dir: string): number => {
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const p = path.join(dir, entry.name);
    const m = entry.isDirectory() ? newest(p) : statSync(p).mtimeMs;
    if (m > max) {
      max = m;
    }
  }
  return max;
};

const sourceOf = (specifier: string) =>
  fileURLToPath(import.meta.resolve(specifier));

/**
 * Bundles what runs outside this process: the serve script (Node, run from the target
 * repository) and the two browser modules. Each is self-contained, so the target repository
 * resolves none of our dependencies.
 */
export const buildPreviewBundles = async (
  opts: { force?: boolean } = {}
): Promise<PreviewBundles> => {
  if (!fromSource) {
    return bundles;
  }
  const runtimeSource = sourceOf("@ultrapaint/renderer-react/runtime");
  const renderSource = sourceOf("@ultrapaint/renderer-react/render");
  const coreSource = sourceOf("@ultrapaint/preview-core/index");
  const outputs = [bundles.render, bundles.runtime, bundles.serve];
  const stale =
    opts.force ||
    !outputs.every((file) => existsSync(file)) ||
    Math.min(...outputs.map((file) => statSync(file).mtimeMs)) <
      Math.max(
        newest(here),
        newest(path.dirname(runtimeSource)),
        newest(path.dirname(coreSource))
      );
  if (stale) {
    // Only a checkout builds them, so a bundled server does not need esbuild installed.
    const { build } = await import("esbuild");
    await build({
      bundle: true,
      entryPoints: [path.join(here, "serve.ts")],
      // Loaded from the target repository when it has them, from this package otherwise.
      external: ["vite", "@vitejs/plugin-react", "@tailwindcss/vite"],
      format: "esm",
      logLevel: "silent",
      outfile: bundles.serve,
      platform: "node",
      target: "node22",
    });
    await build({
      bundle: true,
      entryPoints: [runtimeSource],
      format: "iife",
      logLevel: "silent",
      outfile: bundles.runtime,
      platform: "browser",
      target: "es2022",
    });
    await build({
      bundle: true,
      entryPoints: [renderSource],
      external: ["react", "react-dom", "react-dom/client"],
      format: "esm",
      logLevel: "silent",
      outfile: bundles.render,
      platform: "browser",
      target: "es2022",
    });
  }
  return bundles;
};
