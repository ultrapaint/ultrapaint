import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ProjectConfig, stylesheetsOf } from "./settings.ts";

describe("a configuration file", () => {
  it("still reads with a field that is no setting any more, which is dropped", () => {
    const config = Schema.decodeUnknownSync(ProjectConfig)({
      designsDir: "docs/designs",
      framework: "react-vite",
      providersModule: "providers.tsx",
      storybookUrl: "http://localhost:6006",
    });
    expect(config).toEqual({ designsDir: "docs/designs" });
  });

  it("drops a theme and component packages, which nothing honoured (review D9)", () => {
    const config = Schema.decodeUnknownSync(ProjectConfig)({
      componentPackages: ["@acme/ui"],
      designsDir: "docs/designs",
      theme: "dark",
    });
    expect(config).toEqual({ designsDir: "docs/designs" });
  });
});

describe("a configuration's stylesheets, from the repository's root (ADR 0165)", () => {
  it("reads the old hostCss from where it was relative to, wherever the designs are", () => {
    expect(
      stylesheetsOf({ designsDir: ".", hostCss: ["../src/index.css"] })
    ).toEqual(["src/index.css"]);
    expect(
      stylesheetsOf({ designsDir: "designs", hostCss: ["../../src/index.css"] })
    ).toEqual(["src/index.css"]);
    expect(
      stylesheetsOf({
        designsDir: "docs/designs",
        hostCss: ["../../../apps/web/src/styles.css", "../host.css"],
      })
    ).toEqual(["apps/web/src/styles.css", "docs/designs/host.css"]);
  });

  it("names a package's stylesheet as it is, in either field", () => {
    const spec = "@acme/ui/styles.css";
    expect(
      stylesheetsOf({ designsDir: "docs/designs", hostCss: [spec] })
    ).toEqual([spec]);
    expect(
      stylesheetsOf({ designsDir: "docs/designs", stylesheets: [spec] })
    ).toEqual([spec]);
  });

  it("reads stylesheets over a hostCss beside it", () => {
    expect(
      stylesheetsOf({
        designsDir: "docs/designs",
        hostCss: ["../../../old.css"],
        stylesheets: ["src/index.css"],
      })
    ).toEqual(["src/index.css"]);
  });

  it("names none when neither field is there", () => {
    expect(stylesheetsOf({ designsDir: "docs/designs" })).toEqual([]);
  });
});

describe("a project's name and icon in its configuration (ADR 0107)", () => {
  const read = Schema.decodeUnknownExit(ProjectConfig);

  it("reads an icon of the set in a colour, or an image file of the project", () => {
    const icon = { color: "teal", kind: "icon", name: "boxes" };
    const file = { kind: "file", path: "public/favicon.svg" };
    for (const given of [icon, file]) {
      const config = Schema.decodeUnknownSync(ProjectConfig)({
        designsDir: "docs/designs",
        icon: given,
        name: "Shop admin",
      });
      expect(config).toEqual({
        designsDir: "docs/designs",
        icon: given,
        name: "Shop admin",
      });
    }
  });

  it("refuses a colour outside the set, an icon with no name, and a file outside the project", () => {
    for (const icon of [
      { color: "mauve", kind: "icon", name: "boxes" },
      { color: "teal", kind: "icon", name: "" },
      { kind: "file", path: "../elsewhere/logo.svg" },
      { kind: "file", path: "/etc/logo.svg" },
    ]) {
      expect(read({ designsDir: "docs/designs", icon })._tag).toBe("Failure");
    }
  });
});
