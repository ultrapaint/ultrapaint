import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings.ts";
import {
  applySuggestions,
  describeSuggestions,
  SetupSuggestions,
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
  styleSystem: "tailwind-v4",
};

describe("first-run suggestions", () => {
  it("proposes a designs directory that needs no package", () => {
    expect(applySuggestions(defaultSettings("/repo"), found)).toMatchObject({
      designsDir: "docs/designs",
      libraryDirs: ["packages/ui/src"],
      resolveFrom: "apps/web",
      stylesheets: ["apps/web/src/app.css"],
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
    expect(settings.stylesheets).toEqual(["packages/designs/host.css"]);
  });

  it("points at an application's own components, with no package to import them by", () => {
    const settings = applySuggestions(defaultSettings("/repo"), {
      ...found,
      anchors: [{ dir: "front", name: "front", reason: "depends on react" }],
      cssEntries: ["front/src/index.css"],
      libraries: [
        {
          dir: "front",
          name: "front",
          sourceDir: "front/src/components",
        },
      ],
    });
    expect(settings).toMatchObject({
      libraryDirs: ["front/src/components"],
      resolveFrom: "front",
      stylesheets: ["front/src/index.css"],
    });
  });

  it("says where the pages and the stylesheet are, and nothing of components", () => {
    expect(describeSuggestions(found)).toBe(
      "Found in acme: no designs directory yet, proposing docs/designs; the stylesheet apps/web/src/app.css."
    );
  });

  it("reads suggestions that still name a Tailwind version, and drops it", () => {
    const { styleSystem: _, ...rest } = found;
    const read = (tailwind: string, more: object = {}) =>
      Schema.decodeUnknownSync(SetupSuggestions)({
        ...rest,
        ...more,
        tailwind,
      });
    expect(read("v4", { styleSystem: "tailwind-v4" })).toEqual(found);
    expect(read("v3")).toEqual(rest);
  });
});
