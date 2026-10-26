/**
 * `build/app` as the installers package it (D14): the app's own code, the adapters, the editor,
 * and the server bundled into `server/`, with what the server and the preview load from disk at
 * runtime installed beside them: Vite and its React plugin, which the preview falls back to when
 * the project has none, and TypeScript 5, which the catalogue reads components with. As
 * `pnpm pack:local` packs the command, without touching the checkout's own builds.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  appDir,
  buildAdapters,
  buildShell,
  buildWeb,
  root,
  writeManifest,
} from "./parts.ts";

const serverDir = path.join(root, "apps", "server");
const server = JSON.parse(
  readFileSync(path.join(serverDir, "package.json"), "utf8")
) as { dependencies: Record<string, string> };

/** The range the server is built and tested with, so the app gets the same. */
const range = (name: string) => {
  const found = server.dependencies[name];
  if (!found) {
    throw new Error(`${name} is not a dependency of @ultrapaint/server`);
  }
  return found;
};

console.log("[stage] the app's own code and the adapters");
rmSync(appDir, { force: true, recursive: true });
await buildShell();
await buildAdapters();

console.log("[stage] the editor");
buildWeb();

console.log("[stage] the server");
// The preview's bundles, built only if the sources changed since: an editor running from the
// checkout uses the same ones, and builds them the same way.
execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    "const { buildPreviewBundles } = await import(process.argv[1]); await buildPreviewBundles();",
    path.join(root, "packages", "framework-react-vite", "src", "build.ts"),
  ],
  { cwd: root, stdio: "inherit" }
);
execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    path.join(serverDir, "scripts", "build.ts"),
    "--outdir",
    path.join(appDir, "server"),
  ],
  { cwd: serverDir, stdio: "inherit" }
);

console.log("[stage] what the server and the preview load from disk");
writeManifest({
  "@vitejs/plugin-react": range("@vitejs/plugin-react"),
  "typescript-api": range("typescript-api"),
  vite: range("vite"),
});
execFileSync(
  "npm",
  [
    "install",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--loglevel=error",
  ],
  { cwd: appDir, stdio: "inherit" }
);
console.log(`[stage] ${appDir}`);
