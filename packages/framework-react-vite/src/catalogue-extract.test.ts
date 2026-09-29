import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonc, specifierFromPackage } from "./catalogue-extract.ts";

/** A package on disk: its package.json, and a tsconfig when given one. */
const pkgWith = (pkg: object, tsconfig?: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), "catalogue-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  if (tsconfig !== undefined) {
    writeFileSync(path.join(dir, "tsconfig.json"), tsconfig);
  }
  mkdirSync(path.join(dir, "src/components/ui"), { recursive: true });
  return dir;
};

const specifierOf = (dir: string, rel: string) =>
  specifierFromPackage(path.join(dir, "package.json"), dir, path.join(dir, rel))
    ?.specifier ?? null;

describe("a component's import", () => {
  it("follows the package's exports map", () => {
    const dir = pkgWith({
      exports: { "./ui/*": "./src/components/ui/*.tsx" },
      name: "@acme/ui",
    });
    expect(specifierOf(dir, "src/components/ui/button.tsx")).toBe(
      "@acme/ui/ui/button"
    );
  });

  it("goes through the package's path alias when its exports do not cover it", () => {
    const dir = pkgWith(
      { name: "@acme/app" },
      `{
        // the app's own aliases
        "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },
      }`
    );
    expect(specifierOf(dir, "src/components/ui/button.tsx")).toBe(
      "@/components/ui/button"
    );
  });

  it("is the package's name only when the package has an entry", () => {
    expect(
      specifierOf(pkgWith({ main: "index.js", name: "@acme/lib" }), "src/x.tsx")
    ).toBe("@acme/lib");
    // Nothing would resolve: better no import than one that breaks every page.
    expect(specifierOf(pkgWith({ name: "@acme/app" }), "src/x.tsx")).toBeNull();
  });
});

describe("parseJsonc", () => {
  it("reads comments and trailing commas, and leaves strings alone", () => {
    expect(parseJsonc('{ /* a */ "p": "@/*", // b\n "q": [1, 2,], }')).toEqual({
      p: "@/*",
      q: [1, 2],
    });
  });
});
