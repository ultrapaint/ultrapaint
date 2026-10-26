/**
 * The parts of the app, built into `build/app`: the directory Electron runs in development and
 * the one the installers package. `pnpm desktop:dev` builds the app's own code each time and the
 * editor once; `stage.ts` builds all of it, the server's bundle included, for packaging.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { build } from "esbuild";

export const desktopDir = path.resolve(import.meta.dirname, "..");
export const root = path.resolve(desktopDir, "../..");
export const appDir = path.join(desktopDir, "build", "app");

const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8")
) as { version: string };

export { version };

/** Bundled CommonJS dependencies require Node's own modules, which ESM has no `require` for. */
const requireBanner =
  "import { createRequire as __ultrapaintRequire } from 'node:module'; const require = __ultrapaintRequire(import.meta.url);";

/** The main process, as ESM, and the preload script, as CommonJS: a sandboxed preload must be. */
export const buildShell = async () => {
  mkdirSync(appDir, { recursive: true });
  await build({
    banner: { js: requireBanner },
    bundle: true,
    entryPoints: [path.join(desktopDir, "src", "main.ts")],
    external: ["electron"],
    format: "esm",
    logLevel: "warning",
    outfile: path.join(appDir, "main.mjs"),
    platform: "node",
    target: "node24",
  });
  await build({
    bundle: true,
    entryPoints: [path.join(desktopDir, "src", "preload.ts")],
    external: ["electron"],
    format: "cjs",
    logLevel: "warning",
    outfile: path.join(appDir, "preload.cjs"),
    platform: "node",
    target: "node24",
  });
  // The page the window shows while no project is open.
  await build({
    bundle: true,
    entryPoints: [path.join(desktopDir, "src", "welcome.ts")],
    format: "iife",
    logLevel: "warning",
    outfile: path.join(appDir, "welcome.js"),
    platform: "browser",
    target: "chrome140",
  });
  cpSync(
    path.join(desktopDir, "src", "welcome.html"),
    path.join(appDir, "welcome.html")
  );
};

/** The app's own package.json: what Electron reads to start it, and what is installed with it. */
export const writeManifest = (dependencies: Record<string, string> = {}) => {
  writeFileSync(
    path.join(appDir, "package.json"),
    `${JSON.stringify(
      {
        dependencies,
        description: "A design tool for teams that work with coding agents",
        main: "main.mjs",
        name: "ultrapaint",
        private: true,
        productName: "Ultrapaint",
        type: "module",
        version,
      },
      null,
      2
    )}\n`
  );
};

/**
 * The editor, built into the app rather than into `apps/web/dist`, which an editor already
 * running from the checkout may be serving. Without its source maps, which no one running it
 * reads.
 */
export const buildWeb = () => {
  const out = path.join(desktopDir, "build", "web");
  execFileSync(
    "pnpm",
    [
      "exec",
      "vite",
      "build",
      "--outDir",
      out,
      "--emptyOutDir",
      "--logLevel",
      "warn",
    ],
    { cwd: path.join(root, "apps", "web"), stdio: "inherit" }
  );
  const web = path.join(appDir, "web");
  rmSync(web, { force: true, recursive: true });
  cpSync(out, web, {
    filter: (file) => !file.endsWith(".map"),
    recursive: true,
  });
};

/** Whether the editor was built into the app already. */
export const hasWeb = () => existsSync(path.join(appDir, "web", "index.html"));
