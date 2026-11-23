/**
 * Ultrapaint Dev's Mac app (ADR 0113, UP-116): what gives it its name and icon in the Dock and
 * lets Spotlight open it. `pnpm desktop:dev` makes it inside the checkout
 * (`apps/desktop/.dev-app/Ultrapaint Dev.app`, ignored by git), as T3 Code's dev run does, and
 * makes it again only when its stamp changes. It is a copy of the checkout's Electron app with
 * Ultrapaint Dev's name, icon and a bundle id per checkout, whose executable is a small launcher
 * script: it reads the run the runner saved last and opens the checkout's last build in the
 * bundle's Electron, at once. Electron keeps its own name there: it finds its helper apps by it.
 */
import path from "node:path";
import { Option, Schema } from "effect";
import { DEV_NAME } from "./edition.ts";

export const DEV_APP = `${DEV_NAME}.app`;
/** The bundle's executable: the launcher script. */
export const LAUNCHER_NAME = `${DEV_NAME} Launcher`;
/** Raised when what the runner writes into the bundle changes, so every checkout remakes it. */
export const LAUNCHER_VERSION = 1;
/** The icon in the bundle's `Resources`. */
export const ICON_FILE = "icon.icns";

/** The folder the app and what goes with it are kept in, inside the checkout. */
export const devAppHome = (checkout: string) =>
  path.join(checkout, "apps", "desktop", ".dev-app");

export const devAppPath = (checkout: string) =>
  path.join(devAppHome(checkout), DEV_APP);

/** The run the runner saved last, which a launch from the Dock reads. */
export const devRunFile = (checkout: string) =>
  path.join(devAppHome(checkout), "run.sh");

/** What the app was made from, beside it. */
export const devStampFile = (checkout: string) =>
  path.join(devAppHome(checkout), "stamp.json");

export const devLauncherPath = (bundle: string) =>
  path.join(bundle, "Contents", "MacOS", LAUNCHER_NAME);

export const devElectronPath = (bundle: string) =>
  path.join(bundle, "Contents", "MacOS", "Electron");

/** One bundle id per checkout, from its folder's name: two checkouts never share an app. */
export const devBundleId = (checkout: string) =>
  `dev.ultrapaint.desktop.dev.${
    path
      .basename(checkout)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "") || "local"
  }`;

/** What the app's `Info.plist` says, over what Electron's own says. */
export const devPlist = (bundleId: string) => ({
  CFBundleDisplayName: DEV_NAME,
  CFBundleExecutable: LAUNCHER_NAME,
  CFBundleIconFile: ICON_FILE,
  CFBundleIdentifier: bundleId,
  CFBundleName: DEV_NAME,
});

const HELPERS = [
  ["Electron Helper.app", "helper", "Helper"],
  ["Electron Helper (GPU).app", "helper.gpu", "Helper (GPU)"],
  ["Electron Helper (Plugin).app", "helper.plugin", "Helper (Plugin)"],
  ["Electron Helper (Renderer).app", "helper.renderer", "Helper (Renderer)"],
] as const;

/** The helper apps' `Info.plist` values, named after Ultrapaint Dev, each by its bundle. */
export const devHelperPlists = (bundleId: string) =>
  HELPERS.map(([bundle, suffix, name]) => ({
    bundle,
    values: {
      CFBundleDisplayName: `${DEV_NAME} ${name}`,
      CFBundleIdentifier: `${bundleId}.${suffix}`,
      CFBundleName: `${DEV_NAME} ${name}`,
    },
  }));

/** A value written as one shell word. */
const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** The run file: each variable set only when the one starting the app did not set it. */
export const runScript = (env: Readonly<Record<string, string>>) =>
  `${Object.entries(env)
    .map(
      ([name, value]) =>
        `if [ -z "\${${name}:-}" ]; then export ${name}=${quoted(value)}; fi`
    )
    .join("\n")}\n`;

/** The bundle's executable: the run saved last, then the checkout's build in its Electron. */
export const launcherScript = (options: {
  readonly appDir: string;
  readonly electron: string;
  readonly runFile: string;
}) =>
  [
    "#!/bin/sh",
    "# Ultrapaint Dev (ADR 0113): written by pnpm desktop:dev.",
    `if [ -f ${quoted(options.runFile)} ]; then . ${quoted(options.runFile)}; fi`,
    `exec ${quoted(options.electron)} ${quoted(options.appDir)} "$@"`,
    "",
  ].join("\n");

/** What the app was made from: when any of it changes, the app is made again. */
export const DevAppStamp = Schema.Struct({
  bundleId: Schema.String,
  checkout: Schema.String,
  electronApp: Schema.String,
  electronAppTime: Schema.Number,
  iconTime: Schema.Number,
  launcher: Schema.Number,
});
export type DevAppStamp = typeof DevAppStamp.Type;

const decodeStamp = Schema.decodeUnknownOption(
  Schema.fromJsonString(DevAppStamp)
);

/** Whether the app, made as `kept` says (none when never made), must be made again for `now`. */
export const needsRemaking = (kept: string | undefined, now: DevAppStamp) =>
  Option.match(kept === undefined ? Option.none() : decodeStamp(kept), {
    onNone: () => true,
    onSome: (stamp) =>
      (Object.keys(now) as (keyof DevAppStamp)[]).some(
        (key) => stamp[key] !== now[key]
      ),
  });
