/**
 * The server as a bundle that runs without the workspace: `dist/bin.mjs`, the catalogue's
 * worker next to it, and the preview's bundles in `dist/preview/`, where a bundled server looks
 * for them. Effect is bundled in; only what is loaded from disk at runtime stays a dependency of
 * whoever ships the bundle: TypeScript 5 for the catalogue and esbuild for the preview.
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
