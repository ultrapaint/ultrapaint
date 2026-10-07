import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  catalogueCacheKey,
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
declare const forwardRef: <P>(render: (props: P, ref: unknown) => JSX.Element) => (props: P) => JSX.Element;
declare const memo: <P>(component: (props: P) => JSX.Element) => (props: P) => JSX.Element;
type VariantProps<T> = { variant?: string; size?: string };
`;

const UI_PACKAGE = JSON.stringify({
  exports: { "./*": "./src/*.tsx" },
  name: "@acme/ui",
});

const BUTTON_CVA = `const buttonVariants = cva("btn", {
  variants: { variant: { default: "", outline: "" }, size: { sm: "", lg: "" } },
  defaultVariants: { variant: "default", size: "sm" },
});`;

const BUTTON_VARIANTS = {
  size: ["sm", "lg"],
  variant: ["default", "outline"],
};

/** The variants of each component the library's files make, by name. */
const variantsOf = (files: Record<string, string>) =>
  Object.fromEntries(
    libraries({
      "packages/ui/package.json": UI_PACKAGE,
      ...files,
    }).components.map((c) => [c.name, c.variants])
  );

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

  it("follows a component made by a call to the function it is made from", () => {
    expect(
      variantsOf({
        "packages/ui/src/button.tsx": `${PRELUDE}
${BUTTON_CVA}
const badgeVariants = cva("badge", { variants: { tone: { info: "" } } });
interface Props { variant?: string; size?: string }
function ButtonImpl(props: Props, ref: unknown): JSX.Element {
  return buttonVariants(props);
}
function ChipImpl(props: Props): JSX.Element {
  return buttonVariants(props);
}
const Root = (props: Props): JSX.Element => buttonVariants(props);
const Item = (props: { tone?: string }): JSX.Element => badgeVariants(props);
export const Button = forwardRef(ButtonImpl);
export const Chip = memo(ChipImpl);
export const Group = Object.assign(Root, { Item });
`,
      })
    ).toEqual({
      Button: BUTTON_VARIANTS,
      Chip: BUTTON_VARIANTS,
      Group: BUTTON_VARIANTS,
    });
  });

  it("follows a helper that calls the cva, and a props type naming it in a typeof", () => {
    expect(
      variantsOf({
        "packages/ui/src/button.tsx": `${PRELUDE}
${BUTTON_CVA}
const tagVariants = cva("tag", { variants: { tone: { info: "" } } });
const classes = (p: unknown) => buttonVariants(p);
export interface ButtonProps extends VariantProps<typeof buttonVariants> {
  label?: string;
}
export const Button = (p: { variant?: string; size?: string }): JSX.Element =>
  classes(p);
export function IconButton(p: ButtonProps): JSX.Element {
  return tagVariants(p);
}
`,
      })
    ).toEqual({
      Button: BUTTON_VARIANTS,
      IconButton: BUTTON_VARIANTS,
    });
  });

  it("takes the one cva of a file when nothing leads to it", () => {
    expect(
      variantsOf({
        "packages/ui/src/button.tsx": `${PRELUDE}
${BUTTON_CVA}
declare const classesFor: (name: string) => (props: unknown) => JSX.Element;
const styled = classesFor("button");
export const Button = (p: { variant?: string; size?: string }): JSX.Element =>
  styled(p);
`,
      })
    ).toEqual({ Button: BUTTON_VARIANTS });
  });

  it("finds the cva in another file, through a barrel, an alias and an inline forwardRef", () => {
    expect(
      variantsOf({
        "packages/ui/src/button-variants.ts": `${PRELUDE}
export ${BUTTON_CVA}
`,
        "packages/ui/src/button.tsx": `${PRELUDE}
import { buttonVariants as variants } from "./button-variants";
export const Button = forwardRef(
  (props: { variant?: string; size?: string }, ref: unknown): JSX.Element =>
    variants(props)
);
`,
        "packages/ui/src/index.tsx": `export * from "./button";
export { Button as PrimaryButton } from "./button";
`,
      })
    ).toEqual({
      Button: BUTTON_VARIANTS,
      PrimaryButton: BUTTON_VARIANTS,
    });
  });

  it("finds the cva in a file the component imports through the package's path alias", () => {
    expect(
      variantsOf({
        "packages/ui/src/button.tsx": `${PRELUDE}
import { buttonVariants } from "@/lib/variants";
export const Button = (props: { variant?: string; size?: string }): JSX.Element =>
  buttonVariants(props);
`,
        "packages/ui/src/lib/variants.ts": `${PRELUDE}
export ${BUTTON_CVA}
`,
        "packages/ui/tsconfig.json": `{
  // as shadcn sets it up
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
}`,
      })
    ).toEqual({ Button: BUTTON_VARIANTS });
  });

  it("reads the shadcn v4 shape, a function component with VariantProps in its props", () => {
    expect(
      variantsOf({
        "packages/ui/src/button.tsx": `${PRELUDE}
${BUTTON_CVA}
declare const cn: (...c: unknown[]) => string;
type ComponentProps<T extends string> = { className?: string };
function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>): JSX.Element {
  return buttonVariants({ variant, size, className });
}
export { Button, buttonVariants };
`,
      })
    ).toEqual({ Button: BUTTON_VARIANTS });
  });

  it("reads a component that names the React namespace without importing React", () => {
    // React's types as a library installs them, which the server's own directory may not have.
    const reactTypes = `export = React;
export as namespace React;
declare namespace React {
  interface ReactElement { props: unknown }
  type Size = "sm" | "lg";
  type ReactNode = ReactElement | string | number | boolean | null | undefined;
  namespace JSX { interface Element extends ReactElement {} }
}
`;
    const catalogue = libraries({
      "node_modules/@types/react/index.d.ts": reactTypes,
      "node_modules/@types/react/package.json": JSON.stringify({
        name: "@types/react",
        types: "index.d.ts",
      }),
      "packages/ui/package.json": UI_PACKAGE,
      "packages/ui/src/card.tsx": `export function Card(props: {
  size?: React.Size;
  children?: React.ReactNode;
}): React.JSX.Element {
  return props as unknown as React.JSX.Element;
}
`,
    });
    expect(
      catalogue.components.map((c) => [
        c.name,
        c.props.map((p) => [p.name, p.type.kind]),
      ])
    ).toEqual([
      [
        "Card",
        [
          ["size", "enum"],
          ["children", "node"],
        ],
      ],
    ]);
  });
});

describe("the catalogue's cache key", () => {
  it("changes with any file of the repository the library imports, not only its components", () => {
    const root = mkdtempSync(path.join(tmpdir(), "catalogue-key-"));
    const write = (rel: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
      return path.join(root, rel);
    };
    write(
      "ui/button.tsx",
      'import { buttonVariants } from "./button-variants";\nexport const Button = buttonVariants;\n'
    );
    const variants = write(
      "ui/button-variants.ts",
      'export { tone as buttonVariants } from "../lib/variants";\n'
    );
    const lib = write("lib/variants.ts", "export const tone = 1;\n");
    const ctx = {
      componentPackages: [],
      libraryDirs: [path.join(root, "ui")],
      root,
    };
    const key = () => catalogueCacheKey(ctx, catalogueSourceFiles(ctx));
    const before = key();
    expect(key()).toBe(before);
    utimesSync(variants, 3000, 3000);
    const afterVariants = key();
    expect(afterVariants).not.toBe(before);
    utimesSync(lib, 3000, 3000);
    expect(key()).not.toBe(afterVariants);
  });

  it("changes with a file the library imports through its package's path alias", () => {
    const root = mkdtempSync(path.join(tmpdir(), "catalogue-key-"));
    const write = (rel: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
      return path.join(root, rel);
    };
    write("package.json", JSON.stringify({ name: "app" }));
    write(
      "tsconfig.json",
      '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }'
    );
    write(
      "src/ui/button.tsx",
      'import { tone } from "@/lib/variants";\nexport const Button = tone;\n'
    );
    const lib = write("src/lib/variants.ts", "export const tone = 1;\n");
    const ctx = {
      componentPackages: [],
      libraryDirs: [path.join(root, "src/ui")],
      root,
    };
    const key = () => catalogueCacheKey(ctx, catalogueSourceFiles(ctx));
    const before = key();
    utimesSync(lib, 3000, 3000);
    expect(key()).not.toBe(before);
  });
});
