import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detect } from "./detect.ts";
import { scaffold } from "./scaffold.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const written = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-scaffold-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
};

const { files: app } = scaffold({ dir: ".", name: "x", tokens: {} });
const ui = (name: string) => String(app[`src/components/ui/${name}.tsx`]);

/** Every `data-slot` a source marks, in order. */
const slotsOf = (source: string) =>
  [...source.matchAll(/data-slot="([a-z-]+)"/g)].map(([, slot]) => slot);

/** React's types as far as the catalogue needs them: what a component returns, what it takes. */

describe("a new application", () => {
  it("is one the setup recognises: the app, its own components, its stylesheet", () => {
    const result = scaffold({ dir: "app", name: "Acme Web", tokens: {} });
    expect(result.settings).toEqual({
      hostCss: "app/src/index.css",
      libraryDir: "app/src/components",
      resolveFrom: "app",
    });
    const root = written(result.files);
    const found = detect(root);
    expect(found?.anchors[0]?.dir).toBe("app");
    expect(found?.libraries[0]).toMatchObject({
      inApp: true,
      sourceDir: "app/src/components",
    });
    expect(JSON.parse(String(result.files["app/package.json"])).name).toBe(
      "acme-web"
    );
  });

  it("starts its theme from the tokens it is given, or a neutral set with a dark theme", () => {
    const given = scaffold({
      dir: ".",
      name: "x",
      tokens: { "color-primary": "#ff0000", "radius-card": "12px" },
    }).files["src/index.css"];
    expect(given).toContain(
      "  --color-primary: #ff0000;\n  --radius-card: 12px;"
    );
    expect(given).not.toContain(".dark {");
    const starter = scaffold({ dir: ".", name: "x", tokens: {} }).files[
      "src/index.css"
    ];
    expect(starter).toContain("--color-primary: #2563eb;");
    expect(starter).toContain(".dark {");
  });

  it("depends on what its components import", () => {
    const pkg = JSON.parse(String(app["package.json"]));
    expect(pkg.dependencies).toMatchObject({
      "@base-ui/react": "^1.8.0",
      "class-variance-authority": "^0.7.1",
      clsx: "^2.1.1",
      react: expect.any(String),
      "react-dom": expect.any(String),
      "tailwind-merge": "^3.7.0",
    });
    expect(app["src/lib/cn.ts"]).toContain("twMerge(clsx(inputs))");
  });
});

describe("a blank application", () => {
  const blank = scaffold({
    dir: "app",
    name: "Blank",
    template: "blank",
    tokens: {},
  });

  it("has no components, an empty component directory and a theme that declares nothing", () => {
    expect(
      Object.keys(blank.files).filter((f) =>
        f.startsWith("app/src/components/")
      )
    ).toEqual(["app/src/components/.gitkeep"]);
    expect(blank.files["app/src/index.css"]).toContain("@theme {\n}\n");
    expect(blank.files["app/src/index.css"]).not.toContain("--color-");
    expect(blank.settings).toEqual({
      hostCss: "app/src/index.css",
      libraryDir: "app/src/components",
      resolveFrom: "app",
    });
  });

  it("depends on React and what a shadcn component needs, not on Base UI", () => {
    const pkg = JSON.parse(String(blank.files["app/package.json"]));
    expect(pkg.dependencies["@base-ui/react"]).toBeUndefined();
    expect(pkg.dependencies).toMatchObject({
      "class-variance-authority": expect.any(String),
      react: expect.any(String),
      "react-dom": expect.any(String),
    });
    expect(blank.files["app/src/lib/cn.ts"]).toContain("twMerge");
  });

  it("starts its theme from the tokens it is given", () => {
    const given = scaffold({
      dir: ".",
      name: "x",
      template: "blank",
      tokens: { "color-primary": "#ff0000" },
    }).files["src/index.css"];
    expect(given).toContain("@theme {\n  --color-primary: #ff0000;\n}\n");
  });

  it("is an application detection recognises", () => {
    const found = detect(written(blank.files));
    expect(found?.anchors[0]?.dir).toBe("app");
  });
});

describe("its components", () => {
  it("write their variants in a cva, with the defaults, as shadcn does", () => {
    for (const [name, axes] of [
      ["button", ["size", "variant"]],
      ["badge", ["variant"]],
    ] as const) {
      const source = ui(name);
      expect(source).toContain(
        'import { cva, type VariantProps } from "class-variance-authority";'
      );
      expect(source).toContain(`const ${name}Variants = cva(`);
      expect(source).toContain("variants: {");
      expect(source).toContain("defaultVariants: {");
      for (const axis of axes) {
        expect(source).toContain(`${axis}: "default",`);
      }
      expect(source).toContain(`VariantProps<typeof ${name}Variants>`);
      expect(source).toContain('import { cn } from "@/lib/cn";');
    }
  });

  it("mark every part with data-slot", () => {
    expect(slotsOf(ui("button"))).toEqual(["button"]);
    expect(slotsOf(ui("badge"))).toEqual(["badge"]);
    expect(slotsOf(ui("input"))).toEqual(["input"]);
    expect(slotsOf(ui("label"))).toEqual(["label"]);
    expect(slotsOf(ui("textarea"))).toEqual(["textarea"]);
    expect(slotsOf(ui("card"))).toEqual([
      "card",
      "card-header",
      "card-title",
      "card-description",
      "card-content",
      "card-footer",
    ]);
    expect(slotsOf(ui("checkbox"))).toEqual(["checkbox", "checkbox-indicator"]);
    expect(slotsOf(ui("dialog"))).toEqual(
      expect.arrayContaining([
        "dialog",
        "dialog-trigger",
        "dialog-overlay",
        "dialog-content",
        "dialog-close",
        "dialog-title",
        "dialog-description",
      ])
    );
    expect(slotsOf(ui("select"))).toEqual(
      expect.arrayContaining([
        "select",
        "select-trigger",
        "select-value",
        "select-content",
        "select-item",
      ])
    );
    expect(slotsOf(ui("tabs"))).toEqual([
      "tabs",
      "tabs-list",
      "tabs-trigger",
      "tabs-content",
    ]);
  });

  it("build the dialog, select, tabs and checkbox on Base UI", () => {
    for (const [name, part] of [
      ["dialog", "Dialog"],
      ["select", "Select"],
      ["tabs", "Tabs"],
      ["checkbox", "Checkbox"],
    ] as const) {
      expect(ui(name)).toContain(
        `import { ${part} as ${part}Primitive } from "@base-ui/react/${name}";`
      );
    }
    expect(ui("checkbox")).toContain("data-checked:bg-primary");
    expect(ui("select")).toContain("data-highlighted:bg-accent");
    expect(ui("tabs")).toContain("data-active:bg-background");
  });
});
