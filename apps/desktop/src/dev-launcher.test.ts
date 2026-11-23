import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type DevAppStamp,
  devAppPath,
  devBundleId,
  devHelperPlists,
  devPlist,
  launcherScript,
  needsRemaking,
  runScript,
} from "./dev-launcher.ts";

const STAMP: DevAppStamp = {
  bundleId: "dev.ultrapaint.desktop.dev.ultrapaint",
  checkout: "/Users/a/Code/ultrapaint",
  electronApp:
    "/Users/a/Code/ultrapaint/node_modules/electron/dist/Electron.app",
  electronAppTime: 1,
  iconTime: 2,
  launcher: 1,
};

describe("Ultrapaint Dev's Mac app", () => {
  it("lives inside its checkout, with a bundle id of its own per checkout", () => {
    expect(devAppPath("/Users/a/Code/ultra paint")).toBe(
      "/Users/a/Code/ultra paint/apps/desktop/.dev-app/Ultrapaint Dev.app"
    );
    expect(devBundleId("/Users/a/Code/Ultra-Paint 2")).toBe(
      "dev.ultrapaint.desktop.dev.ultrapaint2"
    );
    expect(devBundleId("/Users/a/Code/ultrapaint")).not.toBe(
      devBundleId("/Users/a/.t3/worktrees/ultrapaint/t3-0a1b")
    );
  });

  it("names itself Ultrapaint Dev, starts through its launcher, and names its helpers after it", () => {
    const plist = devPlist("dev.ultrapaint.desktop.dev.ultrapaint");
    expect(plist.CFBundleName).toBe("Ultrapaint Dev");
    expect(plist.CFBundleDisplayName).toBe("Ultrapaint Dev");
    expect(plist.CFBundleExecutable).toBe("Ultrapaint Dev Launcher");
    expect(
      devHelperPlists("dev.ultrapaint.desktop.dev.ultrapaint").find(
        (h) => h.bundle === "Electron Helper (Renderer).app"
      )?.values
    ).toEqual({
      CFBundleDisplayName: "Ultrapaint Dev Helper (Renderer)",
      CFBundleIdentifier:
        "dev.ultrapaint.desktop.dev.ultrapaint.helper.renderer",
      CFBundleName: "Ultrapaint Dev Helper (Renderer)",
    });
  });

  it("is made again when its checkout, Electron or icon changed, and reused when nothing did", () => {
    expect(needsRemaking(JSON.stringify(STAMP), STAMP)).toBe(false);
    expect(
      needsRemaking(JSON.stringify(STAMP), { ...STAMP, electronAppTime: 3 })
    ).toBe(true);
    expect(
      needsRemaking(JSON.stringify(STAMP), { ...STAMP, iconTime: 9 })
    ).toBe(true);
    expect(needsRemaking(undefined, STAMP)).toBe(true);
    expect(needsRemaking("{", STAMP)).toBe(true);
  });
});

describe("its launcher", () => {
  /** Each test's folder, removed after it. */
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /**
   * The launcher written to a folder with a space in its name, with a stand-in Electron that
   * prints its arguments and the two variables it is given.
   */
  const launch = (env: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "ultra paint-"));
    made.push(dir);
    const electron = path.join(dir, "Electron");
    writeFileSync(
      electron,
      `#!/bin/sh\nprintf '%s|' "$@"; printf '%s|%s' "$ULTRAPAINT_DESKTOP_DEV_RUN" "$ULTRAPAINT_DESKTOP_SERVER_ARGS"\n`
    );
    chmodSync(electron, 0o755);
    const runFile = path.join(dir, "run.sh");
    writeFileSync(
      runFile,
      runScript({
        ULTRAPAINT_DESKTOP_DEV_RUN: '{"commit":"3f2a1c9"}',
        ULTRAPAINT_DESKTOP_SERVER_ARGS: `["it's"]`,
      })
    );
    const launcher = path.join(dir, "Ultrapaint Dev Launcher");
    writeFileSync(
      launcher,
      launcherScript({
        appDir: path.join(dir, "build app"),
        electron,
        runFile,
      })
    );
    chmodSync(launcher, 0o755);
    return {
      dir,
      out: execFileSync(launcher, ["/work/a"], {
        env: { PATH: process.env.PATH ?? "", ...env },
      }).toString(),
    };
  };

  it("opens the checkout's last build with the run the runner saved, from the Dock", () => {
    const { dir, out } = launch({});
    expect(out).toBe(
      `${path.join(dir, "build app")}|/work/a|{"commit":"3f2a1c9"}|["it's"]`
    );
  });

  it("keeps the run the runner gives it over the one saved", () => {
    const { out } = launch({
      ULTRAPAINT_DESKTOP_DEV_RUN: '{"commit":"newer"}',
    });
    expect(out).toContain('{"commit":"newer"}');
  });
});
