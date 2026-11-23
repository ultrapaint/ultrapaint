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
 * telling it why when the pull failed.
 *
 * On a Mac it runs the app inside Ultrapaint Dev's own app (`src/dev-launcher.ts`), made in the
 * checkout when its stamp changed and registered so the Dock and Spotlight know it, and saves the
 * run there for a launch from the Dock, which opens the last build without a runner (UP-116). Such
 * an app, asked to update, starts `--pull-first --after <pid>`: wait for it to exit, pull, then
 * run as above.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { pullMain } from "../src/checkout.ts";
import {
  type DevAppStamp,
  devAppHome,
  devAppPath,
  devBundleId,
  devElectronPath,
  devHelperPlists,
  devLauncherPath,
  devPlist,
  devRunFile,
  devStampFile,
  ICON_FILE,
  LAUNCHER_VERSION,
  launcherScript,
  needsRemaking,
  runnerOptions,
  runScript,
} from "../src/dev-launcher.ts";
import {
  DEV_RUN_ENV,
  type DevRun,
  RESTART_EXIT_CODE,
  RUNNER_ENV,
} from "../src/edition.ts";
import {
  appDir,
  buildAdapters,
  buildShell,
  buildWeb,
  desktopDir,
  hasWeb,
  root,
  version,
  writeManifest,
} from "./parts.ts";

const { after, appArgs, buildOnly, forceWeb, pullFirst } = runnerOptions(
  process.argv.slice(2).filter((arg) => arg !== "--")
);

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
    // Built from changes not committed: no commit says what it holds, so the next start builds again.
    if (git("status", "--porcelain", "--", "apps/web", "packages") === "") {
      writeFileSync(webStamp, `${git("rev-parse", "HEAD")}\n`);
    } else {
      rmSync(webStamp, { force: true });
    }
  }
};

const serverDir = path.join(root, "apps", "server");
const tsx = createRequire(path.join(serverDir, "package.json")).resolve(
  "tsx/cli"
);

/** The checkout's own Electron. */
const checkoutElectron = () =>
  createRequire(path.join(desktopDir, "package.json"))(
    "electron"
  ) as unknown as string;

const run = (command: string, commandArgs: readonly string[]) =>
  execFileSync(command, commandArgs, { stdio: "pipe" });

/** The `.icns` of Ultrapaint Dev's icon, at every size macOS asks for, made from its 1024px PNG. */
const writeIcon = (picture: string, icns: string) => {
  const iconset = path.join(
    mkdtempSync(path.join(tmpdir(), "ultrapaint-dev-")),
    "icon.iconset"
  );
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      run("sips", [
        "-z",
        pixels,
        pixels,
        picture,
        "--out",
        path.join(
          iconset,
          `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`
        ),
      ]);
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", icns]);
  rmSync(path.dirname(iconset), { force: true, recursive: true });
};

/** Sets each string of `values` in the `Info.plist` at `plist`. */
const setPlist = (plist: string, values: Readonly<Record<string, string>>) => {
  for (const [key, value] of Object.entries(values)) {
    run("plutil", ["-replace", key, "-string", value, plist]);
  }
};

/**
 * Tells LaunchServices of the app, at every start as T3 Code does, so that the Dock and Spotlight
 * know its name and icon now rather than when they look again.
 */
const register = (bundle: string) =>
  run(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", bundle]
  );

/**
 * Ultrapaint Dev's Mac app, in the checkout: made again from the checkout's Electron when its
 * stamp changed, as T3 Code's dev run does, else kept. Its launcher, the executable.
 */
const macApp = () => {
  const electronApp = path.resolve(checkoutElectron(), "..", "..", "..");
  const icon = path.join(desktopDir, "resources", "icon-dev.png");
  const bundle = devAppPath(root);
  const launcher = devLauncherPath(bundle);
  const stampFile = devStampFile(root);
  const stamp: DevAppStamp = {
    bundleId: devBundleId(root),
    checkout: root,
    electronApp,
    electronAppTime: statSync(electronApp).mtimeMs,
    iconTime: statSync(icon).mtimeMs,
    launcher: LAUNCHER_VERSION,
  };
  const kept = existsSync(stampFile)
    ? readFileSync(stampFile, "utf8")
    : undefined;
  if (existsSync(launcher) && !needsRemaking(kept, stamp)) {
    register(bundle);
    return launcher;
  }
  console.log(`[desktop] making ${bundle}`);
  rmSync(bundle, { force: true, recursive: true });
  mkdirSync(devAppHome(root), { recursive: true });
  // Its links kept as they are: pointing outside the bundle, they would crash the helpers.
  cpSync(electronApp, bundle, { recursive: true, verbatimSymlinks: true });
  const contents = path.join(bundle, "Contents");
  setPlist(path.join(contents, "Info.plist"), devPlist(stamp.bundleId));
  for (const helper of devHelperPlists(stamp.bundleId)) {
    const plist = path.join(
      contents,
      "Frameworks",
      helper.bundle,
      "Contents",
      "Info.plist"
    );
    if (existsSync(plist)) {
      setPlist(plist, helper.values);
    }
  }
  const icns = path.join(contents, "Resources", ICON_FILE);
  writeIcon(icon, icns);
  // Electron's own icon too, which some of macOS's views read before the bundle's.
  cpSync(icns, path.join(contents, "Resources", "electron.icns"));
  writeFileSync(
    launcher,
    launcherScript({
      appDir,
      electron: devElectronPath(bundle),
      runFile: devRunFile(root),
    })
  );
  chmodSync(launcher, 0o755);
  // Its Info.plist changed: signed again, for this machine, so that macOS runs it.
  run("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    bundle,
  ]);
  writeFileSync(stampFile, `${JSON.stringify(stamp)}\n`);
  register(bundle);
  return launcher;
};

/**
 * What the app runs on: Ultrapaint Dev's own app on a Mac (`mac`), so the Dock shows it by its
 * name and icon; else, or when that app cannot be made, the checkout's Electron.
 */
const electron = (): { readonly binary: string; readonly mac: boolean } => {
  if (process.platform !== "darwin") {
    return { binary: checkoutElectron(), mac: false };
  }
  try {
    return { binary: macApp(), mac: true };
  } catch (error) {
    warn(
      `Ultrapaint Dev's app could not be made, so it runs as Electron: ${error instanceof Error ? error.message : String(error)}`
    );
    return { binary: checkoutElectron(), mac: false };
  }
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

/** How the app starts the server from its sources. */
const SERVER_ARGS = JSON.stringify([
  tsx,
  "--tsconfig",
  path.join(serverDir, "tsconfig.json"),
  path.join(serverDir, "src", "bin.ts"),
]);

/** Runs the app once, to its exit: its exit code. */
const runApp = (devRun: DevRun) =>
  new Promise<number>((resolve) => {
    const { binary, mac } = electron();
    if (mac) {
      // What a launch from the Dock opens with: this run, without a failure that is this one's.
      const { updateFailed: _once, ...saved } = devRun;
      writeFileSync(
        devRunFile(root),
        runScript({
          [DEV_RUN_ENV]: JSON.stringify(saved),
          ULTRAPAINT_DESKTOP_SERVER_ARGS: SERVER_ARGS,
        })
      );
    }
    const child = spawn(
      binary,
      [
        // The app's own path; Ultrapaint Dev's Mac app's launcher gives it itself.
        ...(mac ? [] : [appDir]),
        ...(process.platform === "linux" && !setuidSandbox(binary)
          ? ["--no-sandbox"]
          : []),
        ...appArgs,
      ],
      {
        env: {
          ...process.env,
          [DEV_RUN_ENV]: JSON.stringify(devRun),
          [RUNNER_ENV]: "1",
          ULTRAPAINT_DESKTOP_SERVER_ARGS: SERVER_ARGS,
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

/** Why the update the last runner pulled failed, which it hands to the runner it starts. */
const UPDATE_FAILED_ENV = "ULTRAPAINT_DESKTOP_UPDATE_FAILED";

/**
 * After a pull, a new runner: this one's modules (the build's parts, the version) are the code
 * before the pull. It is waited for, so a terminal that started this one keeps it.
 */
const runAgain = (updateFailed: string | undefined) =>
  new Promise<number>((resolve) => {
    const next = spawn(
      process.execPath,
      [import.meta.filename, ...appArgs, ...(forceWeb ? ["--web"] : [])],
      {
        env: { ...process.env, [UPDATE_FAILED_ENV]: updateFailed ?? "" },
        stdio: "inherit",
      }
    );
    next.on("exit", (code) => resolve(code ?? 0));
  });

/** Whether the process `pid` still runs. */
const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waits for the app opened from the Dock that asked for the update to exit. */
const appGone = (pid: number): Promise<void> =>
  running(pid)
    ? // real clock: a process outside this one, polled until it exits.
      sleep(200).then(() => appGone(pid))
    : Promise.resolve();

/**
 * Builds and runs the app; when it exits to be updated, pulls `main` and hands over to a new
 * runner, telling it why the pull failed when it did. With `--pull-first`, pulls before anything.
 */
const session = async () => {
  if (pullFirst) {
    if (after !== undefined) {
      await appGone(after);
    }
    console.log("[desktop] pulling main, then starting Ultrapaint Dev again");
    process.exit(await runAgain(await pull()));
  }
  await build();
  if (buildOnly) {
    return;
  }
  const updateFailed = process.env[UPDATE_FAILED_ENV] || undefined;
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
  process.exit(await runAgain(await pull()));
};

session().catch((error: unknown) => {
  warn(
    `Ultrapaint Dev could not start: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
