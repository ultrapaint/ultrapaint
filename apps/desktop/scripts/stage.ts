/**
 * `build/app` as the installers package it (D14): the app's own code, the adapters, the editor,
 * and the server bundled into `server/`. Nothing is installed beside them: the canvas draws the
 * editor's own system components (ADR 0040). As `pnpm pack:local` packs the command, without touching
 * the checkout's own builds.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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
console.log("[stage] the app's own code and the adapters");
rmSync(appDir, { force: true, recursive: true });
await buildShell();
await buildAdapters();

console.log("[stage] the editor");
buildWeb();

console.log("[stage] the server");
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

writeManifest();
console.log(`[stage] ${appDir}`);
