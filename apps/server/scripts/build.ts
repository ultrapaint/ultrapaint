/**
 * The server as a bundle that runs without the workspace: `dist/bin.mjs`, the catalogue's
 * worker next to it, and the preview's bundles in `dist/preview/`, where a bundled server looks
 * for them. Effect is bundled in; only TypeScript 5, which the catalogue loads from disk at
 * runtime, stays a dependency of whoever ships the bundle. esbuild is imported only to build the
 * preview's bundles from sources, which a bundled server never does.
 */
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const serverDir = path.resolve(import.meta.dirname, "..");
const frameworkDir = path.resolve(
  serverDir,
  "../../packages/framework-react-vite"
);
const dist = path.join(serverDir, "dist");

await build({
  // Bundled CommonJS dependencies require Node's own modules, which ESM has no `require` for.
  banner: {
    js: "import { createRequire as __ultrapaintRequire } from 'node:module'; const require = __ultrapaintRequire(import.meta.url);",
  },
  bundle: true,
  entryNames: "[name]",
  entryPoints: [
    path.join(serverDir, "src/bin.ts"),
    path.join(frameworkDir, "src/catalogue-worker.ts"),
  ],
  external: ["esbuild", "typescript-api"],
  format: "esm",
  logLevel: "warning",
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "node24",
});

rmSync(path.join(dist, "preview"), { force: true, recursive: true });
cpSync(path.join(frameworkDir, "dist"), path.join(dist, "preview"), {
  recursive: true,
});
console.log("server built");
