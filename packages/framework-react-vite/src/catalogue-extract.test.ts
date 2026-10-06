import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  catalogueSourceFiles,
  parseJsonc,
  specifierFromPackage,
} from "./catalogue-extract.ts";

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
  });

  it("is a path from the package's root for an application's own component", () => {
    // No exports, no alias, no entry: the preview resolves it against the anchor.
    const dir = pkgWith({ name: "front" });
    expect(specifierOf(dir, "src/components/header.tsx")).toBe(
      "/src/components/header"
    );
    expect(specifierOf(dir, "src/components/ui/index.tsx")).toBe(
      "/src/components/ui"
    );
  });

  it("reads the alias from tsconfig.app.json, as Vite's template keeps it", () => {
    const dir = pkgWith({ name: "front" }, '{ "files": [] }');
    writeFileSync(
      path.join(dir, "tsconfig.app.json"),
      '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }'
    );
    expect(specifierOf(dir, "src/components/ui/button.tsx")).toBe(
      "@/components/ui/button"
    );
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

/** A repository with two library packages, one's name the start of the other's. */
const libraries = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "catalogue-build-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  const ctx = {
    componentPackages: [],
    libraryDirs: [
      path.join(root, "packages/ui"),
      path.join(root, "packages/ui-extra"),
    ],
    root,
  };
  return buildCatalogue(ctx, catalogueSourceFiles(ctx));
};

const PRELUDE = `declare namespace JSX { interface Element {} }
declare const cva: (base: string, config?: unknown) => (props?: unknown) => JSX.Element;
`;

// Building a TypeScript program takes seconds, and longer on a loaded machine.
describe("building the catalogue", { timeout: 30_000 }, () => {
  it("gives each component the variants of the cva it uses, not every cva of its file", () => {
    const catalogue = libraries({
      "packages/ui/package.json": JSON.stringify({
        exports: { "./*": "./src/*.tsx" },
        name: "@acme/ui",
      }),
      "packages/ui/src/controls.tsx": `${PRELUDE}
const buttonVariants = cva("btn", {
  variants: { variant: { default: "", outline: "" }, size: { sm: "", "2xl": "" } },
  defaultVariants: { variant: "default", size: "sm" },
});
const badgeVariants = cva("badge", {
  variants: { tone: { info: "", danger: "" } },
  defaultVariants: { tone: "info" },
});
export interface ButtonProps { variant?: string; size?: string }
export function Button(props: ButtonProps): JSX.Element {
  return buttonVariants(props);
}
/** A badge also takes a variant, which its cva does not know. */
export const Badge = (props: { tone?: string; variant?: string }): JSX.Element =>
  badgeVariants(props);
`,
    });
    const byName = new Map(catalogue.components.map((c) => [c.name, c]));
    expect(byName.get("Button")?.variants).toEqual({
      size: ["sm", "2xl"],
      variant: ["default", "outline"],
    });
    expect(
      byName.get("Button")?.props.map((p) => [p.name, p.defaultValue])
    ).toEqual([
      ["variant", "default"],
      ["size", "sm"],
    ]);
    expect(byName.get("Badge")?.variants).toEqual({ tone: ["info", "danger"] });
    expect(
      byName.get("Badge")?.props.find((p) => p.name === "variant")?.defaultValue
    ).toBeUndefined();
    expect(byName.get("Button")?.importFrom).toBe("@acme/ui/controls");
  });

  it("takes a component's package from its own library directory, not one whose name starts it", () => {
    const catalogue = libraries({
      "packages/ui-extra/package.json": JSON.stringify({
        exports: { "./*": "./src/*.tsx" },
        name: "@acme/ui-extra",
      }),
      "packages/ui-extra/src/chip.tsx": `${PRELUDE}
export const Chip = (props: { label: string }): JSX.Element => cva(props.label)();
`,
      "packages/ui/package.json": JSON.stringify({
        exports: { "./*": "./src/*.tsx" },
        name: "@acme/ui",
      }),
    });
    expect(
      catalogue.components.map((c) => [c.name, c.group, c.importFrom])
    ).toEqual([["Chip", "@acme/ui-extra", "@acme/ui-extra/chip"]]);
  });
});
