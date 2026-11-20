import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ProjectConfig } from "./settings.ts";

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
