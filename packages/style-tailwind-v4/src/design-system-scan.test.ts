import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { afterAll, describe, expect, it } from "vitest";
import {
  inlineThemeAliases,
  scanDesignSystem,
  themeOf,
} from "./design-system-scan.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const repository = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-scan-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
};

describe("scanning a Tailwind v4 design system", () => {
  it("reads the theme, follows imports and variables, and splits themes", () => {
    const root = repository({
      "node_modules/tailwindcss/package.json": '{"name":"tailwindcss"}',
      "node_modules/tailwindcss/theme.css": `@theme default {
  --color-red-500: oklch(63.7% 0.237 25.331);
  --text-sm: 0.875rem;
  --text-sm--line-height: calc(1.25 / 0.875);
  --font-weight-bold: 700;
  --radius-lg: 0.5rem;
  --spacing: 0.25rem;
}`,
      "packages/ui/theme.css": `/* tokens */
:root { --primary: #112233; --background: #ffffff; }
.dark { --primary: #445566; --background: #000000; }
@theme inline {
  --color-primary: var(--primary);
  --color-background: var(--background);
  --color-brand-500: #ff0000;
  --font-sans: "Inter", sans-serif;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.1);
}`,
      "packages/web/src/app.css": `@import "tailwindcss";\n@import "../../ui/theme.css";\n`,
    });
    const settings = {
      ...defaultSettings(root),
      designsDir: "designs",
      hostCss: ["../../packages/web/src/app.css"],
    };
    const { designSystem, files, notes } = scanDesignSystem({
      anchorDir: root,
      root,
      settings,
    });
    expect(files).toEqual([
      "packages/web/src/app.css",
      "packages/ui/theme.css",
    ]);
    const semantic = designSystem.colors.find((g) => g.name === "Semantic");
    expect(semantic?.tokens).toEqual([
      {
        name: "color-background",
        value: "#ffffff",
        values: { dark: "#000000" },
      },
      { name: "color-primary", value: "#112233", values: { dark: "#445566" } },
    ]);
    // The repository's own colours replace Tailwind's palette.
    expect(designSystem.colors.map((g) => g.name)).toEqual([
      "Semantic",
      "Brand",
    ]);
    expect(designSystem.themes).toEqual(["light", "dark"]);
    expect(designSystem.typography.sizes).toEqual([
      { lineHeight: "calc(1.25 / 0.875)", name: "text-sm", value: "0.875rem" },
    ]);
    expect(designSystem.typography.fonts[0]?.name).toBe("font-sans");
    // Only text-sm is in this theme, so only the styles set in it are started.
    expect(designSystem.typography.styles.map((s) => s.name)).toEqual([
      "Body sm",
      "Label",
      "Code",
    ]);
    expect(designSystem.typography.styles[0]).toEqual({
      group: "body",
      name: "Body sm",
      role: "paragraph",
      size: "$text-sm",
    });
    expect(designSystem.typography.weights[0]).toEqual({
      name: "font-weight-bold",
      value: "700",
    });
    expect(designSystem.radius).toEqual([
      { name: "radius-lg", value: "0.5rem" },
    ]);
    expect(designSystem.shadows[0]?.name).toBe("shadow-card");
    expect(designSystem.spacing.base).toBe("0.25rem");
    expect(notes.some((n) => n.includes("Tailwind v4"))).toBe(false);
  });

  it("reads border widths, layout, motion and icons, and starts the elevation", () => {
    const root = repository({
      "app.css": `@import "tailwindcss";
@theme {
  --color-background: #fff;
  --color-card: #fff;
  --color-popover: #fff;
  --border-width-thick: 2px;
  --border-width-thin: 1px;
  --duration-slow: 0.3s;
}`,
      "node_modules/tailwindcss/package.json": '{"name":"tailwindcss"}',
      "node_modules/tailwindcss/theme.css": `@theme default {
  --breakpoint-lg: 64rem;
  --breakpoint-sm: 40rem;
  --container-md: 28rem;
  --container-3xl: 48rem;
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --animate-spin: spin 1s linear infinite;
  --default-transition-duration: 150ms;
  --shadow-sm: 0 1px 3px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px rgb(0 0 0 / 0.1);
}`,
      "package.json": '{"dependencies":{"lucide-react":"^1.0.0"}}',
    });
    const { designSystem } = scanDesignSystem({
      anchorDir: root,
      root,
      settings: {
        ...defaultSettings(root),
        designsDir: ".",
        hostCss: ["../app.css"],
      },
    });
    expect(designSystem.borderWidths?.map((t) => t.name)).toEqual([
      "border-width-thin",
      "border-width-thick",
    ]);
    // Smallest first, not by name.
    expect(designSystem.layout?.breakpoints?.map((t) => t.name)).toEqual([
      "breakpoint-sm",
      "breakpoint-lg",
    ]);
    expect(designSystem.layout?.containers?.map((t) => t.name)).toEqual([
      "container-md",
      "container-3xl",
    ]);
    expect(designSystem.motion).toEqual({
      animations: [{ name: "animate-spin", value: "spin 1s linear infinite" }],
      durations: [
        { name: "default-transition-duration", value: "150ms" },
        { name: "duration-slow", value: "0.3s" },
      ],
      easings: [{ name: "ease-out", value: "cubic-bezier(0, 0, 0.2, 1)" }],
    });
    expect(designSystem.icons).toEqual({
      from: "lucide-react",
      sizes: [16, 20, 24],
    });
    // No muted surface: no sunken level.
    expect(designSystem.elevation).toEqual([
      {
        description: expect.any(String),
        name: "Default",
        surface: "$color-background",
      },
      {
        description: expect.any(String),
        name: "Raised",
        shadow: "$shadow-sm",
        surface: "$color-card",
      },
      {
        description: expect.any(String),
        layer: 50,
        name: "Overlay",
        shadow: "$shadow-lg",
        surface: "$color-popover",
      },
    ]);
  });

  it("keeps a quoted `;` in a value, and follows every var() of it on its own", () => {
    const root = repository({
      "app.css": `@import "tailwindcss";
:root { --icon: url("data:image/svg+xml;utf8,<svg/>"); --shadow-color: rgb(0 0 0 / 0.1); }
@theme {
  --font-display: "Foo;Bar", sans-serif;
  --shadow-card: 0 1px var(--blur) var(--shadow-color);
}`,
      "node_modules/tailwindcss/package.json": '{"name":"tailwindcss"}',
    });
    const { designSystem } = scanDesignSystem({
      anchorDir: root,
      root,
      settings: {
        ...defaultSettings(root),
        designsDir: ".",
        hostCss: ["../app.css"],
      },
    });
    expect(designSystem.typography.fonts).toEqual([
      { name: "font-display", value: '"Foo;Bar", sans-serif' },
    ]);
    expect(designSystem.shadows).toEqual([
      { name: "shadow-card", value: "0 1px var(--blur) rgb(0 0 0 / 0.1)" },
    ]);
  });

  it("drops the defaults a theme resets, by namespace, multi-word ones included", () => {
    const scan = (theme: string) => {
      const root = repository({
        "app.css": `@import "tailwindcss";\n@theme {\n${theme}\n}`,
        "node_modules/tailwindcss/package.json": '{"name":"tailwindcss"}',
        "node_modules/tailwindcss/theme.css": `@theme default {
  --color-red-500: red;
  --font-sans: Inter;
  --font-weight-bold: 700;
  --inset-shadow-sm: inset 0 1px 1px rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px rgb(0 0 0 / 0.1);
  --radius-lg: 0.5rem;
}`,
      });
      return scanDesignSystem({
        anchorDir: root,
        root,
        settings: {
          ...defaultSettings(root),
          designsDir: ".",
          hostCss: ["../app.css"],
        },
      });
    };
    const reset = scan(`  --color-*: initial;
  --font-*: initial;
  --font-weight-*: initial;
  --shadow-*: initial;
  --font-display: Lato;`);
    expect(reset.designSystem.colors).toEqual([]);
    expect(reset.designSystem.typography.fonts).toEqual([
      { name: "font-display", value: "Lato" },
    ]);
    expect(reset.designSystem.typography.weights).toEqual([]);
    // `--shadow-*` is its own namespace: `--inset-shadow-*` is not in it.
    expect(reset.designSystem.shadows).toEqual([]);
    expect(reset.designSystem.radius.map((t) => t.name)).toEqual(["radius-lg"]);
    expect(reset.ownTokens).toEqual(["font-display"]);
    // `--font-*` alone keeps the weights, as Tailwind does.
    expect(
      scan("  --font-*: initial;").designSystem.typography.weights
    ).toEqual([{ name: "font-weight-bold", value: "700" }]);
    const everything = scan("  --*: initial;\n  --radius-card: 12px;");
    expect(everything.designSystem.radius).toEqual([
      { name: "radius-card", value: "12px" },
    ]);
    expect(everything.designSystem.typography.fonts).toEqual([]);
  });

  it("sorts type sizes by length, rem and px alike", () => {
    const root = repository({
      "app.css": `@import "tailwindcss";
@theme { --text-body: 1rem; --text-caption: 12px; --text-title: 1.5rem; --text-display: 30px; }`,
      "node_modules/tailwindcss/package.json": '{"name":"tailwindcss"}',
    });
    const { designSystem } = scanDesignSystem({
      anchorDir: root,
      root,
      settings: {
        ...defaultSettings(root),
        designsDir: ".",
        hostCss: ["../app.css"],
      },
    });
    expect(designSystem.typography.sizes.map((s) => s.name)).toEqual([
      "text-caption",
      "text-body",
      "text-title",
      "text-display",
    ]);
  });

  it("says so when there is no Tailwind", () => {
    const root = repository({ "app.css": ":root { --x: 1px; }" });
    const { designSystem, notes } = scanDesignSystem({
      anchorDir: root,
      root,
      settings: {
        ...defaultSettings(root),
        designsDir: ".",
        hostCss: ["../app.css"],
      },
    });
    expect(designSystem.colors).toEqual([]);
    expect(notes.some((n) => n.includes("Tailwind v4"))).toBe(true);
  });
});

describe("the theme a block belongs to", () => {
  it("is dark only where the block applies in the dark", () => {
    expect(themeOf(".dark")).toBe("dark");
    expect(themeOf(":root.dark")).toBe("dark");
    expect(themeOf("@media (prefers-color-scheme: dark) :root")).toBe("dark");
    expect(themeOf('[data-theme="dark"]')).toBe("dark");
    expect(themeOf(":root:not(.dark)")).toBeNull();
    expect(themeOf(':root:not(:where(.dark, [data-theme="dark"]))')).toBeNull();
    expect(themeOf(".dark-blue")).toBeNull();
    expect(themeOf(".darker")).toBeNull();
    expect(themeOf('[data-theme="ocean"]:not(.dark)')).toBe("ocean");
    expect(themeOf('[data-theme="light"]')).toBeNull();
  });
});

describe("inline theme aliases", () => {
  it("are the @theme inline variables that stand for another variable", () => {
    const root = repository({
      "node_modules/tailwindcss/package.json": '{"name":"tailwindcss"}',
      "web/app.css": `@import "tailwindcss";
:root { --foreground: #111; }
.dark { --foreground: #eee; }
@theme inline {
  --color-foreground: var(--foreground);
  --color-brand: #ff0000;
  --radius-lg: calc(var(--radius) * 1.2);
}`,
    });
    const aliases = inlineThemeAliases(
      ["../web/app.css"],
      path.join(root, "designs", "host.css"),
      path.join(root, "web")
    );
    expect([...aliases]).toEqual([["--color-foreground", "var(--foreground)"]]);
  });
});
