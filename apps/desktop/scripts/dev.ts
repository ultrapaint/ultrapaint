/**
 * `pnpm desktop:dev`: the app from this checkout. The main process and the preload script are
 * built each time, the editor only when the app has none yet (`--web` builds it again), and the
 * server runs from its TypeScript sources through tsx, as `pnpm dev` runs it. Any other argument
 * goes to the app.
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  buildAdapters,
  buildShell,
  buildWeb,
  desktopDir,
  hasWeb,
  root,
  writeManifest,
} from "./parts.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const rebuildWeb = args.includes("--web");

await buildShell();
await buildAdapters();
writeManifest();
if (rebuildWeb || !hasWeb()) {
  console.log("[desktop] building the editor into the app");
  buildWeb();
}

const serverDir = path.join(root, "apps", "server");
const tsx = createRequire(path.join(serverDir, "package.json")).resolve(
  "tsx/cli"
);
const electron = createRequire(path.join(desktopDir, "package.json"))(
  "electron"
) as unknown as string;

/**
 * Chromium sandboxes its renderers with a setuid helper where the kernel keeps user namespaces
 * from unprivileged programs, as Ubuntu does; the helper in node_modules is not installed setuid,
 * and Chromium refuses to start without it. The checkout runs without that sandbox then, as T3
 * Code's does; an installed app has its own.
 */
const setuidSandbox = () => {
  try {
    const helper = statSync(
      path.join(path.dirname(electron), "chrome-sandbox")
    );
    // Setuid and 755: the permission bits, in octal, end the mode.
    return helper.uid === 0 && helper.mode.toString(8).endsWith("4755");
  } catch {
    return false;
  }
};

const child = spawn(
  electron,
  [
    path.join(desktopDir, "build", "app"),
    ...(process.platform === "linux" && !setuidSandbox()
      ? ["--no-sandbox"]
      : []),
    ...args.filter((arg) => arg !== "--web"),
  ],
  {
    env: {
      ...process.env,
      ULTRAPAINT_DESKTOP_SERVER_ARGS: JSON.stringify([
        tsx,
        "--tsconfig",
        path.join(serverDir, "tsconfig.json"),
        path.join(serverDir, "src", "bin.ts"),
      ]),
    },
    stdio: "inherit",
  }
);
child.on("exit", (code) => process.exit(code ?? 0));
