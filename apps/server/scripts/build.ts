/**
 * The server as a bundle that runs without the workspace: `dist/bin.mjs`, Effect bundled in, and
 * the DESIGN.md linter's configuration copied beside it, where the linter looks.
 */
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const serverDir = path.resolve(import.meta.dirname, "..");
// `--outdir <dir>`: somewhere else than `dist`, as the desktop app stages its own copy.
const outdirFlag = process.argv.indexOf("--outdir");
const dist =
  outdirFlag === -1
    ? path.join(serverDir, "dist")
    : path.resolve(process.argv[outdirFlag + 1] ?? "dist");

await build({
  // Bundled CommonJS dependencies require Node's own modules, which ESM has no `require` for.
  banner: {
    js: "import { createRequire as __ultrapaintRequire } from 'node:module'; const require = __ultrapaintRequire(import.meta.url);",
  },
  bundle: true,
  entryNames: "[name]",
  entryPoints: [path.join(serverDir, "src/bin.ts")],
  format: "esm",
  logLevel: "warning",
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "node24",
});

// The DESIGN.md linter reads its configuration from beside its own module, which the bundle is.
const linter = fileURLToPath(import.meta.resolve("@google/design.md/linter"));
cpSync(
  path.join(path.dirname(linter), "spec-config.yaml"),
  path.join(dist, "spec-config.yaml")
);

console.log("server built");
