import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applicationFileOf,
  applicationNameOf,
} from "@ultrapaint/contracts/catalogue";
import { SYSTEM_COMPONENTS } from "@ultrapaint/system-components/catalogue";
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

/** What a source exports, in its one `export { … };`. */
const EXPORTS_RE = /export \{ ([^}]+) \};/;

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
  /** The system components built on Base UI, as the starter's components are. */
  const ON_BASE_UI = new Set([
    "Avatar",
    "Checkbox",
    "Dialog",
    "Menu",
    "Popover",
    "Select",
    "Separator",
    "Switch",
    "Tabs",
    "Tooltip",
  ]);
  // Base UI names its modules as the application its files.
  const kebab = applicationFileOf;

  it("are the system components one to one, a file each by the same name", () => {
    expect(
      Object.keys(app)
        .filter((f) => f.startsWith("src/components/ui/"))
        .sort()
    ).toEqual(
      SYSTEM_COMPONENTS.map(
        (p) => `src/components/ui/${kebab(p.name)}.tsx`
      ).sort()
    );
    for (const meta of SYSTEM_COMPONENTS) {
      expect(ui(kebab(meta.name))).toContain(`function ${meta.name}(`);
    }
  });

  it("mark each part with the system component's data-slot, the root as root", () => {
    for (const meta of SYSTEM_COMPONENTS) {
      const marked = new Set(slotsOf(ui(kebab(meta.name))));
      expect(
        meta.slots.map((s) => s.name).filter((slot) => !marked.has(slot))
      ).toEqual([]);
    }
  });

  it("write their variants in a cva by the system component's axes and members, the first the default", () => {
    for (const meta of SYSTEM_COMPONENTS) {
      const source = ui(kebab(meta.name));
      for (const [axis, members] of Object.entries(meta.variants)) {
        expect(source).toContain(`${axis}: "${members[0]}",`);
        for (const member of members) {
          expect(source).toMatch(new RegExp(`\\b${member}: "`));
        }
      }
    }
  });

  it("are on Base UI where the system component is", () => {
    for (const meta of SYSTEM_COMPONENTS) {
      const source = ui(kebab(meta.name));
      expect(source.includes(`from "@base-ui/react/${kebab(meta.name)}"`)).toBe(
        ON_BASE_UI.has(meta.name)
      );
    }
  });

  it("take a system component's slots as parts among their children", () => {
    expect(ui("dialog")).toContain(
      "export { Dialog, DialogFooter, DialogHeader, DialogTrigger, dialogVariants };"
    );
    expect(ui("card")).toContain("export { Card, CardFooter, CardHeader };");
    expect(ui("input")).toContain(
      "export { Input, InputIcon, inputVariants };"
    );
    expect(app["src/lib/parts.ts"]).toContain("export function split(");
  });

  it("export a part for every slot that holds nodes, by the name the Code tab writes", () => {
    for (const meta of SYSTEM_COMPONENTS) {
      const exported = ui(kebab(meta.name)).match(EXPORTS_RE)?.[1];
      const names = new Set(exported?.split(", "));
      expect(
        meta.slots
          .filter((s) => s.holds === "nodes")
          .map((s) => applicationNameOf(meta.name, s.name))
          .filter((name) => !names.has(name))
      ).toEqual([]);
    }
  });
});
