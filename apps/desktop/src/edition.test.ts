import { describe, expect, it } from "vitest";
import {
  DEV_RUN_ENV,
  dataDirsOf,
  editionOf,
  folderArgument,
  RUNNER_ENV,
} from "./edition.ts";

const devRun = {
  branch: "main",
  checkout: "/code/ultrapaint",
  commit: "3f2a1c9",
  version: "0.4.0",
};

describe("editionOf", () => {
  it("is the release where nothing says the app runs from a checkout", () => {
    expect(editionOf({})).toEqual({ _tag: "Release" });
  });

  it("is Ultrapaint Dev, with the checkout it runs, where the runner says so", () => {
    expect(editionOf({ [DEV_RUN_ENV]: JSON.stringify(devRun) })).toEqual({
      _tag: "Dev",
      ...devRun,
      runner: false,
    });
  });

  it("knows a runner waits for it only when the runner started it, not when opened from the Dock", () => {
    const started = editionOf({
      [DEV_RUN_ENV]: JSON.stringify(devRun),
      [RUNNER_ENV]: "1",
    });
    expect(started._tag === "Dev" && started.runner).toBe(true);
  });

  it("carries why the last update from main failed, when the runner says it did", () => {
    const edition = editionOf({
      [DEV_RUN_ENV]: JSON.stringify({
        ...devRun,
        updateFailed: "git pull: not possible to fast-forward",
      }),
    });
    expect(edition._tag === "Dev" && edition.updateFailed).toBe(
      "git pull: not possible to fast-forward"
    );
  });

  it("refuses a run it cannot read, rather than starting as the release", () => {
    expect(() => editionOf({ [DEV_RUN_ENV]: "{" })).toThrow();
  });
});

describe("dataDirsOf", () => {
  const appData = "/Users/a/Library/Application Support";

  it("keeps the release's data where it always was", () => {
    expect(dataDirsOf({ _tag: "Release" }, appData, undefined)).toEqual({
      own: `${appData}/Ultrapaint`,
    });
  });

  it("gives Ultrapaint Dev a folder of its own, first filled from the release's", () => {
    expect(
      dataDirsOf({ _tag: "Dev", ...devRun, runner: true }, appData, undefined)
    ).toEqual({
      firstFrom: `${appData}/Ultrapaint`,
      own: `${appData}/Ultrapaint Dev`,
    });
  });

  it("puts the data where the variable says, and copies nothing into a throwaway folder", () => {
    expect(
      dataDirsOf({ _tag: "Dev", ...devRun, runner: true }, appData, "/tmp/try")
    ).toEqual({ own: "/tmp/try" });
  });
});

describe("folderArgument", () => {
  it("reads the folder after the release's executable", () => {
    expect(
      folderArgument(["/Applications/Ultrapaint.app/x", "/work/a"], {
        _tag: "Release",
      })
    ).toBe("/work/a");
  });

  it("reads the folder after Ultrapaint Dev's executable and the app's own path, past flags", () => {
    expect(
      folderArgument(
        [
          "electron",
          "/code/ultrapaint/apps/desktop/build/app",
          "--x",
          "/work/a",
        ],
        { _tag: "Dev", ...devRun, runner: true }
      )
    ).toBe("/work/a");
  });

  it("takes the app's own path for no folder", () => {
    expect(
      folderArgument(["electron", "/code/ultrapaint/apps/desktop/build/app"], {
        _tag: "Dev",
        ...devRun,
        runner: true,
      })
    ).toBeUndefined();
  });
});
