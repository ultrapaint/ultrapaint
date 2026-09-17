import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginDist = path.resolve(here, "../dist/plugin.js");
export const runtimeDist = path.resolve(here, "../dist/runtime.js");

const newest = (dir: string): number => {
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const m = entry.isDirectory() ? newest(p) : statSync(p).mtimeMs;
    if (m > max) max = m;
  }
  return max;
};

/**
 * Bundles the Vite plugin (node) and the iframe runtime (browser) into `dist/` so the target
 * repository can import them by absolute path without resolving any of our dependencies.
 */
export const buildHostPlugin = async (
  opts: { force?: boolean } = {},
): Promise<{ plugin: string; runtime: string }> => {
  const srcDir = path.resolve(here);
  const stale =
    opts.force ||
    !existsSync(pluginDist) ||
    !existsSync(runtimeDist) ||
    Math.min(statSync(pluginDist).mtimeMs, statSync(runtimeDist).mtimeMs) < newest(srcDir);
  if (stale) {
    await esbuild.build({
      entryPoints: [path.join(srcDir, "plugin.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: pluginDist,
      logLevel: "silent",
    });
    await esbuild.build({
      entryPoints: [path.join(srcDir, "runtime.ts")],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      outfile: runtimeDist,
      logLevel: "silent",
    });
  }
  return { plugin: pluginDist, runtime: runtimeDist };
};
