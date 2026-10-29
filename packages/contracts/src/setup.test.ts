import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings.ts";
import {
  applySuggestions,
  describeSuggestions,
  hostCssFor,
  relativePosix,
  type SetupSuggestions,
  stylesheetOf,
} from "./setup.ts";

const found: SetupSuggestions = {
  anchors: [
    { dir: "apps/web", name: "@acme/web", reason: "depends on @acme/ui" },
  ],
  cssEntries: ["apps/web/src/app.css"],
  designsDirs: [],
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

  it("points at an application's own components, with no package to import them by", () => {
    const settings = applySuggestions(defaultSettings("/repo"), {
      ...found,
      anchors: [{ dir: "front", name: "front", reason: "depends on react" }],
      cssEntries: ["front/src/index.css"],
      libraries: [
        {
          dir: "front",
          inApp: true,
          name: "front",
          sourceDir: "front/src/components",
        },
      ],
    });
    expect(settings).toMatchObject({
      componentPackages: [],
      hostCss: ["../../../front/src/index.css"],
      libraryDirs: ["front/src/components"],
      resolveFrom: "front",
    });
  });

  it("names a stylesheet by its file, and back", () => {
    const spec = hostCssFor("docs/designs", "apps/web/src/app.css");
    expect(stylesheetOf("docs/designs", spec)).toBe("apps/web/src/app.css");
    expect(stylesheetOf("docs/designs", "@acme/ui/styles.css")).toBe(
      "@acme/ui/styles.css"
    );
  });

  it("says where the pages and the stylesheet are, and nothing of components", () => {
    expect(describeSuggestions(found)).toBe(
      "Found in acme: no designs directory yet, proposing docs/designs; the stylesheet apps/web/src/app.css."
    );
  });
});
