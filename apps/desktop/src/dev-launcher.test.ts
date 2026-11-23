import { describe, expect, it } from "vitest";
import {
  DEV_BUNDLE_ID,
  DEV_PLIST,
  devAppFiles,
  madeFor,
} from "./dev-launcher.ts";

const files = devAppFiles({
  checkout: "/Users/a/Code/ultra paint",
  electron: "44.4.5",
  version: "0.4.0",
});

describe("Ultrapaint Dev.app", () => {
  it("names itself Ultrapaint Dev, with a bundle id of its own beside the release's", () => {
    expect(DEV_PLIST.CFBundleName).toBe("Ultrapaint Dev");
    expect(DEV_PLIST.CFBundleDisplayName).toBe("Ultrapaint Dev");
    expect(DEV_BUNDLE_ID).not.toBe("dev.ultrapaint.desktop");
    expect(JSON.parse(files["package.json"]).productName).toBe(
      "Ultrapaint Dev"
    );
  });

  it("loads the checkout's build, its path written as a file address, only once started by the runner", () => {
    // Awaited, so it runs before Electron is ready; dynamic, so a Dock launch never loads a build
    // that may not be there yet.
    expect(files["main.mjs"]).toContain(
      'await import("file:///Users/a/Code/ultra%20paint/apps/desktop/build/app/main.mjs")'
    );
    // Before it: what hands an app opened from the Dock over to the runner.
    expect(files["main.mjs"].indexOf("./relaunch.mjs")).toBeLessThan(
      files["main.mjs"].indexOf("build/app/main.mjs")
    );
  });

  it("hands over to the checkout's runner through the login shell, the checkout's path given apart", () => {
    expect(files["relaunch.mjs"]).toContain('"/Users/a/Code/ultra paint"');
    expect(files["relaunch.mjs"]).toContain("ULTRAPAINT_DESKTOP_DEV_RUN");
    expect(files["relaunch.mjs"]).toContain('"-l"');
  });

  it("knows the checkout and the Electron it was made for, and none for a launcher it cannot read", () => {
    expect(madeFor(files["package.json"])).toEqual({
      checkout: "/Users/a/Code/ultra paint",
      electron: "44.4.5",
    });
    expect(madeFor("{")).toBeUndefined();
    expect(madeFor("{}")).toBeUndefined();
  });
});
