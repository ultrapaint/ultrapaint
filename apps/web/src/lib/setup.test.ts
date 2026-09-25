import { defaultSettings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";
import { describe, expect, it } from "vitest";
import { applySuggestions, relativePosix } from "./setup.ts";

const found: SetupSuggestions = {
  anchors: [
    { dir: "apps/web", name: "@acme/web", reason: "depends on @acme/ui" },
  ],
  cssEntries: ["apps/web/src/app.css"],
  designsDirs: [],
  framework: "react-vite",
  libraries: [
    { dir: "packages/ui", name: "@acme/ui", sourceDir: "packages/ui/src" },
  ],
  repoName: "acme",
  tailwind: "v4",
};

describe("first-run suggestions", () => {
  it("writes host CSS imports relative to the generated directory", () => {
    expect(
      relativePosix("docs/designs/.ultrapaint", "apps/web/src/app.css")
    ).toBe("../../../apps/web/src/app.css");
    expect(relativePosix("designs/.ultrapaint", "designs/host.css")).toBe(
      "../host.css"
    );
  });

  it("proposes a designs directory that needs no package", () => {
    expect(applySuggestions(defaultSettings("/repo"), found)).toMatchObject({
      componentPackages: ["@acme/ui"],
      designsDir: "docs/designs",
      hostCss: ["../../../apps/web/src/app.css"],
      libraryDirs: ["packages/ui/src"],
      resolveFrom: "apps/web",
    });
  });

  it("leaves a designs package to resolve its own imports", () => {
    const settings = applySuggestions(defaultSettings("/repo"), {
      ...found,
      anchors: [{ dir: "packages/designs", name: "designs", reason: "" }],
      cssEntries: ["apps/web/src/app.css", "packages/designs/host.css"],
      designsDirs: ["packages/designs"],
    });
    expect(settings.resolveFrom).toBeUndefined();
    expect(settings.designsDir).toBe("packages/designs");
    expect(settings.hostCss).toEqual(["../host.css"]);
  });
});
