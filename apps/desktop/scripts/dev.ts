/**
 * `pnpm desktop:dev`: Ultrapaint Dev, the app from this checkout, beside the release (ADR 0113).
 * The main process and the preload script are built each time, the editor when its sources
 * changed since it was built into the app (`--web` builds it again anyway), and the server runs
 * from its TypeScript sources through tsx, as `pnpm dev` runs it; a local project runs the
 * checkout's `ultrapaint --dev`. `--build-only` builds and stops. Any other argument goes to the
 * app.
 *
 * The runner stays while the app runs. When the app exits to be updated (Pull and restart), it
 * pulls `main`, runs `pnpm install` when the lockfile changed, builds again and starts it again,
 * telling it why when the pull failed. On a Mac, the app runs inside `Ultrapaint Dev.app` when
 * `pnpm desktop:dev-app` made one for this Electron, so the Dock shows it by its name and icon.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { pullMain } from "../src/checkout.ts";
import {
  devAppDir,
  devAppExecutable,
  devAppPath,
  electronOfDevApp,
} from "../src/dev-launcher.ts";
import { DEV_RUN_ENV, type DevRun, RESTART_EXIT_CODE } from "../src/edition.ts";
import {
  appDir,
  buildAdapters,
  buildShell,
  buildWeb,
  desktopDir,
  electronVersion,
  hasWeb,
  root,
  version,
  writeManifest,
} from "./parts.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const OWN = new Set(["--web", "--build-only"]);
const forceWeb = args.includes("--web");
const buildOnly = args.includes("--build-only");
const appArgs = args.filter((arg) => !OWN.has(arg));

const git = (...gitArgs: string[]) =>
  execFileSync("git", gitArgs, { cwd: root, stdio: "pipe" }).toString().trim();

/** The commit the editor was built into the app from, beside it. */
const webStamp = path.join(appDir, "web", ".commit");

/**
 * Whether the editor built into the app is older than its sources: never built, built before the
 * stamp, or its sources (the web app and the packages it builds from) changed since, committed or
 * not.
 */
const webIsStale = () => {
  if (!(hasWeb() && existsSync(webStamp))) {
    return true;
  }
  const built = readFileSync(webStamp, "utf8").trim();
  try {
    execFileSync(
      "git",
      ["diff", "--quiet", built, "--", "apps/web", "packages"],
      {
        cwd: root,
        stdio: "ignore",
      }
    );
    return false;
  } catch {
    // A difference, or a stamp git no longer knows: built again.
    return true;
  }
};

const build = async () => {
  await buildShell("dev");
  await buildAdapters();
  writeManifest("dev");
  if (forceWeb || webIsStale()) {
    console.log("[desktop] building the editor into the app");
    buildWeb();
    writeFileSync(webStamp, `${git("rev-parse", "HEAD")}\n`);
  }
};

const serverDir = path.join(root, "apps", "server");
const tsx = createRequire(path.join(serverDir, "package.json")).resolve(
  "tsx/cli"
);

/**
 * The Electron the app runs on: `Ultrapaint Dev.app`'s, on a Mac where it was made for this
 * Electron, else the checkout's own.
 */
const electron = () => {
  const checkouts = createRequire(path.join(desktopDir, "package.json"))(
    "electron"
  ) as unknown as string;
  if (process.platform !== "darwin") {
    return checkouts;
  }
  const bundle = devAppPath(homedir());
  const made = path.join(devAppDir(bundle), "package.json");
  if (!existsSync(made)) {
    return checkouts;
  }
  if (electronOfDevApp(readFileSync(made, "utf8")) !== electronVersion) {
    warn(
      `${bundle} was made for another Electron than this checkout's ${electronVersion}: run pnpm desktop:dev-app again. Ultrapaint Dev runs on the checkout's Electron meanwhile.`
    );
    return checkouts;
  }
  return devAppExecutable(bundle);
};

/**
 * Says something the person must read: in the terminal, and on a Mac in a dialog too when the
 * runner has no terminal (`Ultrapaint Dev.app` started it).
 */
const warn = (message: string) => {
  console.error(`[desktop] ${message}`);
  if (process.platform === "darwin" && !process.stdout.isTTY) {
    spawn(
      "osascript",
      [
        "-e",
        `display alert "Ultrapaint Dev" message ${JSON.stringify(message)}`,
      ],
      { detached: true, stdio: "ignore" }
    ).unref();
  }
};

/**
 * Chromium sandboxes its renderers with a setuid helper where the kernel keeps user namespaces
 * from unprivileged programs, as Ubuntu does; the helper in node_modules is not installed setuid,
 * and Chromium refuses to start without it. The checkout runs without that sandbox then, as T3
 * Code's does; an installed app has its own.
 */
const setuidSandbox = (binary: string) => {
  try {
    const helper = statSync(path.join(path.dirname(binary), "chrome-sandbox"));
    // Setuid and 755: the permission bits, in octal, end the mode.
    return helper.uid === 0 && helper.mode.toString(8).endsWith("4755");
  } catch {
    return false;
  }
};

/** Runs the app once, to its exit: its exit code. */
const runApp = (run: DevRun) =>
  new Promise<number>((resolve) => {
    const binary = electron();
    const child = spawn(
      binary,
      [
        // The app's own path, which `Ultrapaint Dev.app` ignores and loads the same build.
        appDir,
        ...(process.platform === "linux" && !setuidSandbox(binary)
          ? ["--no-sandbox"]
          : []),
        ...appArgs,
      ],
      {
        env: {
          ...process.env,
          [DEV_RUN_ENV]: JSON.stringify(run),
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
    child.on("exit", (code) => resolve(code ?? 0));
  });

/** Pulls `main` into the checkout: why it could not, or nothing when it did. */
const pull = () =>
  Effect.runPromise(
    pullMain(root, { install: ["pnpm", "install", "--frozen-lockfile"] }).pipe(
      Effect.as(undefined),
      // Said to the app, which shows it on its update item: the runner starts it all the same.
      Effect.catch((error) => Effect.succeed(error.message)),
      Effect.provide(NodeServices.layer)
    )
  );

/**
 * Builds and runs the app; when it exits to be updated, pulls `main` and does it again, telling
 * the next run why the pull failed when it did.
 */
const session = async (updateFailed?: string): Promise<void> => {
  await build();
  if (buildOnly) {
    return;
  }
  const code = await runApp({
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    checkout: root,
    commit: git("rev-parse", "--short", "HEAD"),
    ...(updateFailed === undefined ? {} : { updateFailed }),
    version,
  });
  if (code !== RESTART_EXIT_CODE) {
    process.exit(code);
  }
  console.log("[desktop] pulling main, then starting Ultrapaint Dev again");
  return session(await pull());
};

session().catch((error: unknown) => {
  warn(
    `Ultrapaint Dev could not start: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
