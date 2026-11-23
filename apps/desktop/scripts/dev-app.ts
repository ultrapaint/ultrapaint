/**
 * `pnpm desktop:dev-app`, on a Mac: writes `~/Applications/Ultrapaint Dev.app` (ADR 0113), which
 * starts Ultrapaint Dev, this checkout's app, from the Dock or Spotlight. It is a copy of the
 * checkout's Electron named Ultrapaint Dev, with its icon and a bundle id of its own, signed for
 * this machine (ad hoc), around a small app that hands over to `scripts/dev.ts` (see
 * `src/dev-launcher.ts`). Run it again when the checkout's Electron changes: the runner says so.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  DEV_ICON_FILE,
  DEV_PLIST,
  devAppDir,
  devAppFiles,
  devAppPath,
} from "../src/dev-launcher.ts";
import { desktopDir, electronVersion, root, version } from "./parts.ts";

if (process.platform !== "darwin") {
  console.error(
    "[dev-app] Ultrapaint Dev.app is for macOS: elsewhere, run pnpm desktop:dev."
  );
  process.exit(1);
}

const run = (command: string, args: readonly string[]) =>
  execFileSync(command, args, { stdio: "inherit" });

// The build the app loads, there before it is first opened from the Dock.
run(process.execPath, [
  path.join(desktopDir, "scripts", "dev.ts"),
  "--build-only",
]);

/** The checkout's Electron app, around the binary its package names. */
const electronApp = path.resolve(
  createRequire(path.join(desktopDir, "package.json"))(
    "electron"
  ) as unknown as string,
  "..",
  "..",
  ".."
);
const bundle = devAppPath(homedir());
console.log(`[dev-app] ${electronApp} -> ${bundle}`);
rmSync(bundle, { force: true, recursive: true });
mkdirSync(path.dirname(bundle), { recursive: true });
// `ditto` keeps what an app bundle holds: its links, modes and frameworks.
run("ditto", [electronApp, bundle]);

const plist = path.join(bundle, "Contents", "Info.plist");
for (const [key, value] of Object.entries(DEV_PLIST)) {
  run("plutil", ["-replace", key, "-string", value, plist]);
}

// The icon, at every size macOS asks for, from the 1024px picture.
const iconset = path.join(
  mkdtempSync(path.join(tmpdir(), "ultrapaint-dev-")),
  "icon.iconset"
);
mkdirSync(iconset);
const picture = path.join(desktopDir, "resources", "icon-dev.png");
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    run("sips", [
      "-z",
      pixels,
      pixels,
      picture,
      "--out",
      path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
    ]);
  }
}
run("iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  path.join(bundle, "Contents", "Resources", DEV_ICON_FILE),
]);
rmSync(path.dirname(iconset), { force: true, recursive: true });

const app = devAppDir(bundle);
mkdirSync(app, { recursive: true });
for (const [name, content] of Object.entries(
  devAppFiles({ checkout: root, electron: electronVersion, version })
)) {
  writeFileSync(path.join(app, name), content);
}

// Its Info.plist changed: signed again, for this machine, so that macOS runs it.
run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
// Its name and icon, told to the Dock and Spotlight now rather than when they look again.
run(
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
  ["-f", bundle]
);
console.log(
  "[dev-app] Ultrapaint Dev is in your Applications folder: open it from Spotlight or the Dock."
);
