/**
 * `Ultrapaint Dev.app` (ADR 0113): what starts Ultrapaint Dev from the Dock or Spotlight on a
 * Mac, written into `~/Applications` by `pnpm desktop:dev-app`. It is a copy of the checkout's
 * Electron app named Ultrapaint Dev, with its icon and bundle id, holding a small app of its own:
 *
 * - opened from the Dock, it hands over to the checkout's runner (`scripts/dev.ts`) through the
 *   login shell, for its `PATH`, and exits; the runner builds what changed and starts it again;
 * - started by the runner, which describes the run (`ULTRAPAINT_DESKTOP_DEV_RUN`), it loads the
 *   checkout's build, so that the Dock shows one Ultrapaint Dev.
 *
 * Its Electron executable keeps its name: Electron finds its helper apps by it.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Option, Schema } from "effect";
import { DEV_NAME, DEV_RUN_ENV } from "./edition.ts";

export const DEV_APP = `${DEV_NAME}.app`;
export const DEV_BUNDLE_ID = "dev.ultrapaint.desktop.dev";
/** The icon in the bundle's `Resources`. */
export const DEV_ICON_FILE = "ultrapaint-dev.icns";

/** What `Info.plist` says of it, over what Electron's own says. */
export const DEV_PLIST = {
  CFBundleDisplayName: DEV_NAME,
  CFBundleIconFile: DEV_ICON_FILE,
  CFBundleIdentifier: DEV_BUNDLE_ID,
  CFBundleName: DEV_NAME,
} as const;

/** Where it is written: the person's own Applications folder. */
export const devAppPath = (home: string) =>
  path.join(home, "Applications", DEV_APP);

/** The executable the runner starts it with. */
export const devAppExecutable = (bundle: string) =>
  path.join(bundle, "Contents", "MacOS", "Electron");

/** Where its small app is, in the bundle. */
export const devAppDir = (bundle: string) =>
  path.join(bundle, "Contents", "Resources", "app");

/** The small app's files, by their name in its folder. */
export const devAppFiles = (options: {
  readonly checkout: string;
  /** The Electron it is a copy of: one changed in the checkout needs the app made again. */
  readonly electron: string;
  readonly version: string;
}) => {
  const main = pathToFileURL(
    path.join(options.checkout, "apps", "desktop", "build", "app", "main.mjs")
  ).href;
  return {
    "main.mjs": `// Ultrapaint Dev (ADR 0113): hands over to its runner when opened from the Dock, else runs the
// checkout's build. Written by \`pnpm desktop:dev-app\`.
import "./relaunch.mjs";
await import(${JSON.stringify(main)});
`,
    "package.json": `${JSON.stringify(
      {
        checkout: options.checkout,
        electron: options.electron,
        main: "main.mjs",
        name: "ultrapaint-dev",
        private: true,
        productName: DEV_NAME,
        type: "module",
        version: options.version,
      },
      null,
      2
    )}\n`,
    "relaunch.mjs": `// Opened from the Dock or Spotlight, Ultrapaint Dev hands over to its checkout's runner, which
// builds what changed and starts it again with the run it describes (ADR 0113).
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

if (process.env.${DEV_RUN_ENV} === undefined) {
  const log = path.join(homedir(), "Library", "Logs", ${JSON.stringify(`${DEV_NAME}.log`)});
  mkdirSync(path.dirname(log), { recursive: true });
  const out = openSync(log, "a");
  spawn(
    process.env.SHELL || "/bin/zsh",
    ["-l", "-c", 'cd "$1" && exec node apps/desktop/scripts/dev.ts', "ultrapaint-dev", ${JSON.stringify(options.checkout)}],
    { detached: true, stdio: ["ignore", out, out] }
  ).unref();
  process.exit(0);
}
`,
  } as const;
};

const decodeMade = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ checkout: Schema.String, electron: Schema.String })
  )
);

/**
 * The checkout and the Electron a launcher was made for, as its `package.json` says; none when it
 * cannot tell. Another checkout's launcher would load that checkout's build.
 */
export const madeFor = (
  packageJson: string
): { readonly checkout: string; readonly electron: string } | undefined =>
  Option.getOrUndefined(decodeMade(packageJson));
