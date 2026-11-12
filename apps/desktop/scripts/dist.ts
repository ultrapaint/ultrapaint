/**
 * `pnpm desktop:build`: the app staged (`stage.ts`) and packaged with electron-builder into
 * `release/` (D14): an AppImage and a deb on Linux, a dmg and a zip on macOS, for the machine it
 * runs on, unsigned. Each comes with its update feed (`latest-linux.yml`, `latest-mac.yml`), which
 * the release workflow attaches to the GitHub release with the installers (ADR 0051): an AppImage
 * updates itself from it. `--dir` packages without making the installers, to try the app as it is
 * installed.
 *
 * electron-builder is run at a pinned version with npx rather than installed in the workspace:
 * its dependency tree is large, and only this script needs it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appDir, desktopDir, version } from "./parts.ts";

const ELECTRON_BUILDER = "electron-builder@26.18.0";

/** The Electron the app is developed with, pinned exactly in its package.json. */
const electronVersion = (
  JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
  }
).devDependencies.electron;

const onlyDir = process.argv.includes("--dir");

/** One of electron-builder's own placeholders, which it fills in for each installer. */
const placeholder = (name: string) => `\${${name}}`;

execFileSync(process.execPath, [path.join(desktopDir, "scripts", "stage.ts")], {
  stdio: "inherit",
});

/** The app icon: the mark on its tile, on Apple's grid, from `resources/icon.svg`. */
const icon = path.join(desktopDir, "resources", "icon.png");

/**
 * The macOS icon as Icon Composer makes it (`resources/icon.icon`: the black fill and the mark as
 * its layer), compiled into the app's asset catalog by Xcode's actool. macOS 26 draws an app that
 * has only an icns inside a grey tile of its own, whatever the icns's shape.
 */
const macIcon = path.join(desktopDir, "resources", "icon.icon");

const config = {
  appId: "dev.ultrapaint.desktop",
  artifactName: `ultrapaint-${placeholder("version")}-${placeholder("os")}-${placeholder("arch")}.${placeholder("ext")}`,
  // The server and the adapters are run by other processes and read through the sandbox's
  // binds: plain files, not an archive.
  asar: false,
  buildVersion: version,
  copyright: `Copyright © ${new Date().getFullYear()} Ultrapaint`,
  deb: {
    // The agents run inside bubblewrap where it is installed (ADR 0013).
    recommends: ["bubblewrap", "git"],
  },
  directories: { output: path.join(desktopDir, "release") },
  electronVersion,
  executableName: "ultrapaint",
  linux: {
    category: "Development",
    icon,
    maintainer: "Alessandro Narciso <alessandro@narciso.dev>",
    syncDesktopName: true,
    synopsis: "A design tool for teams that work with coding agents",
    target: onlyDir ? ["dir"] : ["AppImage", "deb"],
  },
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: false,
    icon: macIcon,
    // Unsigned until there is an Apple Developer account (PLAN-desktop, open questions).
    identity: null,
    target: onlyDir ? ["dir"] : ["dmg", "zip"],
  },
  // `stage.ts` installs nothing beside the app's parts: there is nothing to rebuild.
  npmRebuild: false,
  productName: "Ultrapaint",
  // Where the update feed points; the workflow uploads, so electron-builder never publishes.
  publish: { owner: "ultrapaint", provider: "github", repo: "ultrapaint" },
};

const configFile = path.join(desktopDir, "build", "electron-builder.json");
writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
execFileSync(
  "npx",
  [
    "--yes",
    ELECTRON_BUILDER,
    "--config",
    configFile,
    "--projectDir",
    appDir,
    process.platform === "darwin" ? "--mac" : "--linux",
    "--publish",
    "never",
  ],
  { cwd: desktopDir, stdio: "inherit" }
);
console.log(`[dist] ${path.join(desktopDir, "release")}`);
