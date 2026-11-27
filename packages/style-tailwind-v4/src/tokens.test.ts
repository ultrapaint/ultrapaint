import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { isTokenName } from "@ultrapaint/contracts/token-table";
import type { DesignSystemContext } from "@ultrapaint/framework-api/node";
import { afterAll, describe, expect, it } from "vitest";
import { readTokens, writeTokens } from "./tokens.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const APP_CSS = `@import "tailwindcss";

@theme {
  --color-brand: #2563eb;
  --radius-lg: 0.75rem;
  --text-xs--line-height: 1rem;
}

@theme inline {
  --color-primary: var(--primary);
  --color-background: var(--background);
}

:root {
  --primary: oklch(0.6 0.2 260); /* the brand */
  --background: #ffffff;
}

.dark {
  --primary: oklch(0.8 0.1 260);
}
`;

/** A repository whose preview imports `src/app.css`, as the settings name it. */
const project = (css = APP_CSS): DesignSystemContext => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-tokens-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "designs"), { recursive: true });
  writeFileSync(path.join(root, "src/app.css"), css);
  return {
    anchorDir: root,
    root,
    settings: {
      ...defaultSettings(root),
      designsDir: "designs",
      stylesheets: ["src/app.css"],
    },
  };
};

const byName = (ctx: DesignSystemContext, name: string) =>
  readTokens(ctx).tokens.find((t) => t.name === name);

/** The files as the changes leave them. */
const edited = (
  ctx: DesignSystemContext,
  changes: Parameters<typeof writeTokens>[1]
) => writeTokens(ctx, changes).edits;

/** A package installed in the repository, with its stylesheet as `exports` names it. */
const installed = (
  ctx: DesignSystemContext,
  pkg: string,
  file: string,
  css: string
) => {
  const dir = path.join(ctx.root, "node_modules", pkg);
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ exports: { ".": { style: `./${file}` } }, name: pkg })
  );
  writeFileSync(path.join(dir, file), css);
};

describe("reading Tailwind v4 tokens", () => {
  it("reads a package's stylesheet the settings name as it is imported (ADR 0165)", () => {
    const app = project("");
    const ctx: DesignSystemContext = {
      ...app,
      settings: { ...app.settings, stylesheets: ["@acme/ui/styles.css"] },
    };
    installed(
      ctx,
      "@acme/ui",
      "styles.css",
      "@theme {\n  --color-acme: #123456;\n}\n"
    );
    expect(byName(ctx, "color-acme")?.value).toBe("#123456");
  });

  it("reads each @theme variable with where its value is written", () => {
    const ctx = project();
    const source = readTokens(ctx);
    expect(source.files).toEqual(["src/app.css"]);
    expect(source.themes).toEqual(["dark"]);
    const brand = byName(ctx, "color-brand");
    expect(brand).toMatchObject({ kind: "color", own: true, value: "#2563eb" });
    const at = brand?.origins?.[""];
    expect(at?.file).toBe("src/app.css");
    expect(APP_CSS.slice(at?.start, at?.end)).toBe("#2563eb");
    expect(byName(ctx, "radius-lg")?.kind).toBe("radius");
    // A sub-property of a token is not a token of its own.
    expect(byName(ctx, "text-xs--line-height")).toBeUndefined();
  });

  it("follows an alias to the variable that holds the value, theme by theme", () => {
    const ctx = project();
    const primary = byName(ctx, "color-primary");
    expect(primary?.value).toBe("oklch(0.6 0.2 260)");
    expect(primary?.values).toEqual({ dark: "oklch(0.8 0.1 260)" });
    const light = primary?.origins?.[""];
    const dark = primary?.origins?.dark;
    expect(APP_CSS.slice(light?.start, light?.end)).toBe("oklch(0.6 0.2 260)");
    expect(APP_CSS.slice(dark?.start, dark?.end)).toBe("oklch(0.8 0.1 260)");
  });
});

describe("reading tokens declared outside @theme", () => {
  const ROOT_CSS = `@import "tailwindcss";

:root {
  --color-panel: #f5f5f5;
  --header-height: 4rem;
  --primary: #2563eb;
}

.dark {
  --color-panel: #18181b;
}
`;

  it("reads a token-named variable of a plain :root block, with where it is written, theme by theme", () => {
    const ctx = project(ROOT_CSS);
    const panel = byName(ctx, "color-panel");
    expect(panel).toMatchObject({
      kind: "color",
      own: true,
      value: "#f5f5f5",
      values: { dark: "#18181b" },
      variableOnly: true,
    });
    const light = panel?.origins?.[""];
    const dark = panel?.origins?.dark;
    expect(light?.file).toBe("src/app.css");
    expect(ROOT_CSS.slice(light?.start, light?.end)).toBe("#f5f5f5");
    expect(ROOT_CSS.slice(dark?.start, dark?.end)).toBe("#18181b");
  });

  it("reads a token of a selector list one of whose selectors is the document's", () => {
    const ctx = project(`@import "tailwindcss";
:root, [data-theme="light"] {
  --color-panel: #f5f5f5;
}
:root:not(.dark) {
  --color-line: #e5e5e5;
}
:root .card {
  --color-card: #ffffff;
}
`);
    expect(byName(ctx, "color-panel")?.value).toBe("#f5f5f5");
    expect(byName(ctx, "color-line")?.value).toBe("#e5e5e5");
    // A descendant of the root is part of the page, not the document.
    expect(byName(ctx, "color-card")).toBeUndefined();
  });

  it("reads a theme's value only from the theme's own block, not a responsive or a descendant one", () => {
    const css = `@import "tailwindcss";
:root {
  --color-panel: #f5f5f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-panel: #18181b;
  }
}
@media (prefers-color-scheme: dark) and (min-width: 1024px) {
  :root {
    --color-panel: #27272a;
  }
}
.dark .card {
  --color-panel: #3f3f46;
}
`;
    const ctx = project(css);
    const panel = byName(ctx, "color-panel");
    expect(panel?.values).toEqual({ dark: "#18181b" });
    const dark = panel?.origins?.dark;
    expect(css.slice(dark?.start, dark?.end)).toBe("#18181b");
  });

  it("resolves a :root token's var() through the unconditional blocks alone", () => {
    const ctx = project(`@import "tailwindcss";
:root {
  --base: #ffffff;
  --color-panel: var(--base);
}
@media (max-width: 640px) {
  :root {
    --base: #000000;
  }
}
`);
    expect(byName(ctx, "color-panel")?.value).toBe("#ffffff");
  });

  it("reads the :root declaration of a token over the alias @theme gives it", () => {
    const ctx = project(`@import "tailwindcss";
@theme {
  --color-panel: var(--panel);
}
:root {
  --panel: #ffffff;
  --color-panel: #f5f5f5;
}
`);
    expect(byName(ctx, "color-panel")?.value).toBe("#f5f5f5");
  });

  it("reads the @theme inline value of a token :root declares too, the one its utilities draw", () => {
    const ctx = project(`@import "tailwindcss";
@theme inline {
  --color-panel: var(--panel);
  --color-line: #e5e5e5;
}
:root {
  --panel: #ffffff;
  --color-panel: #f5f5f5;
  --color-line: #d4d4d4;
}
`);
    const source = readTokens(ctx);
    const value = (name: string) =>
      source.tokens.find((t) => t.name === name)?.value;
    expect(value("color-panel")).toBe("#ffffff");
    expect(value("color-line")).toBe("#e5e5e5");
    expect(source.notes).toContain(
      "color-line is declared both in @theme inline (src/app.css) and in a plain :root block (src/app.css). Its utilities draw the @theme inline value, so that is the one read and written; var(--color-line) draws the :root one."
    );
  });

  it("reads body.dark as the dark theme's block, and body alone as no theme's", () => {
    const ctx = project(`@import "tailwindcss";
:root {
  --color-panel: #f5f5f5;
}
body.dark {
  --color-panel: #18181b;
}
body {
  --color-line: #e5e5e5;
}
`);
    expect(byName(ctx, "color-panel")?.values).toEqual({ dark: "#18181b" });
    expect(byName(ctx, "color-line")).toBeUndefined();
  });

  it("makes no token of a variable whose name is no token's", () => {
    const ctx = project(ROOT_CSS);
    expect(byName(ctx, "header-height")).toBeUndefined();
    expect(byName(ctx, "primary")).toBeUndefined();
  });

  it("reads shadcn's arrangement as before: the @theme alias, its variables no tokens", () => {
    const ctx = project();
    const own = readTokens(ctx).tokens.filter((t) => t.own);
    expect(own.map((t) => t.name).sort()).toEqual([
      "color-background",
      "color-brand",
      "color-primary",
      "radius-lg",
    ]);
    expect(own.some((t) => t.variableOnly)).toBe(false);
  });

  it("makes no token of a value under a condition, or of one only a theme declares", () => {
    const ctx = project(`@import "tailwindcss";
@media (max-width: 640px) {
  :root {
    --text-hero: 1rem;
  }
}
@supports (color: oklch(0 0 0)) {
  :root {
    --color-accent: oklch(0.7 0.2 40);
  }
}
.dark {
  --color-night: #000;
}
`);
    for (const name of ["text-hero", "color-accent", "color-night"]) {
      expect(byName(ctx, name)).toBeUndefined();
    }
  });

  it("keeps the base value of a :root token outside a media query that sets it again", () => {
    const css = `@import "tailwindcss";
:root {
  --text-hero: 2rem;
}
@media (max-width: 640px) {
  :root {
    --text-hero: 1rem;
  }
}
`;
    const ctx = project(css);
    const hero = byName(ctx, "text-hero");
    expect(hero?.value).toBe("2rem");
    const at = hero?.origins?.[""];
    expect(css.slice(at?.start, at?.end)).toBe("2rem");
  });

  it("reads the :root value of a token @theme declares too, which wins in the app, and notes both", () => {
    const ctx = project(`@import "tailwindcss";
@theme {
  --color-panel: #ffffff;
}
:root {
  --color-panel: #f5f5f5;
}
`);
    const source = readTokens(ctx);
    const panel = source.tokens.find((t) => t.name === "color-panel");
    expect(panel?.value).toBe("#f5f5f5");
    expect(panel?.variableOnly).toBeUndefined();
    expect(source.notes).toEqual([
      "color-panel is declared both in @theme (src/app.css) and in a plain :root block (src/app.css). The :root value is the one the app draws, so it is the one read and written.",
    ]);
  });

  it("lists no Tailwind default a :root block declares again", () => {
    const ctx = project(`@import "tailwindcss";
:root {
  --color-red-500: #ef4444;
}
`);
    mkdirSync(path.join(ctx.root, "node_modules/tailwindcss"), {
      recursive: true,
    });
    writeFileSync(
      path.join(ctx.root, "node_modules/tailwindcss/package.json"),
      '{"name":"tailwindcss"}'
    );
    writeFileSync(
      path.join(ctx.root, "node_modules/tailwindcss/theme.css"),
      "@theme default {\n  --color-red-500: red;\n}"
    );
    const reds = readTokens(ctx).tokens.filter(
      (t) => t.name === "color-red-500"
    );
    expect(reds).toEqual([
      expect.objectContaining({ own: true, value: "#ef4444" }),
    ]);
  });
});

describe("reading a theme that resets Tailwind's defaults", () => {
  it("lists no default the theme resets, and no token declared before the reset", () => {
    const ctx = project(`@import "tailwindcss";
@theme {
  --color-old: #000;
  --color-*: initial;
  --font-weight-*: initial;
  --color-brand: #2563eb;
}
`);
    mkdirSync(path.join(ctx.root, "node_modules/tailwindcss"), {
      recursive: true,
    });
    writeFileSync(
      path.join(ctx.root, "node_modules/tailwindcss/package.json"),
      '{"name":"tailwindcss"}'
    );
    writeFileSync(
      path.join(ctx.root, "node_modules/tailwindcss/theme.css"),
      `@theme default {
  --color-red-500: red;
  --font-sans: Inter;
  --font-weight-bold: 700;
  --radius-lg: 0.5rem;
}`
    );
    const names = readTokens(ctx).tokens.map((t) => `${t.name} ${t.own}`);
    expect(names.sort()).toEqual([
      "color-brand true",
      "font-sans false",
      "radius-lg false",
    ]);
  });
});

describe("writing Tailwind v4 tokens back", () => {
  it("changes a value where it is written, in each theme", () => {
    const ctx = project();
    const edits = edited(ctx, [
      { name: "color-primary", value: "#ff0000" },
      { name: "color-primary", theme: "dark", value: "#ff8888" },
      { name: "color-brand", value: "#111111" },
    ]);
    expect(edits.map((e) => e.file)).toEqual(["src/app.css"]);
    const text = edits[0]?.text ?? "";
    expect(text).toContain("--primary: #ff0000; /* the brand */");
    expect(text).toContain(".dark {\n  --primary: #ff8888;\n}");
    expect(text).toContain("--color-brand: #111111;");
    // Only the values moved.
    expect(text.length).toBe(
      APP_CSS.length -
        "oklch(0.6 0.2 260)".length * 1 +
        "#ff0000".length -
        "oklch(0.8 0.1 260)".length +
        "#ff8888".length
    );
  });

  it("adds a token to the theme, a theme's value to its block, and takes one out", () => {
    const ctx = project();
    const edits = edited(ctx, [
      { name: "color-accent", value: "#f59e0b" },
      { name: "color-brand", theme: "dark", value: "#60a5fa" },
      { name: "radius-lg", remove: true },
    ]);
    const file = path.join(ctx.root, "src/app.css");
    writeFileSync(file, edits[0]?.text ?? "");
    const text = readFileSync(file, "utf8");
    expect(text).toContain(
      "@theme {\n  --color-brand: #2563eb;\n  --text-xs--line-height: 1rem;\n  --color-accent: #f59e0b;\n}"
    );
    expect(text).not.toContain("--radius-lg");
    expect(byName(ctx, "color-accent")?.value).toBe("#f59e0b");
    expect(byName(ctx, "color-brand")?.values).toEqual({ dark: "#60a5fa" });
    expect(byName(ctx, "radius-lg")).toBeUndefined();
  });

  it("reads back a token of every name the token table takes, and of none it refuses", () => {
    const names = [
      "color-accent",
      "color-Brand_1",
      "spacing-1_5",
      "spacing-1.5",
      "color-a--b",
    ];
    const ctx = project();
    const edits = edited(
      ctx,
      names.map((name) => ({ name, value: "#f59e0b" }))
    );
    writeFileSync(path.join(ctx.root, "src/app.css"), edits[0]?.text ?? "");
    expect(names.filter((name) => byName(ctx, name) !== undefined)).toEqual(
      names.filter(isTokenName)
    );
    // A step's dot is written as Tailwind writes it.
    expect(edits[0]?.text).toContain("--spacing-1_5: #f59e0b;");
  });

  it("takes the last of two changes to one value, and gives tokens sharing a variable their own", () => {
    const ctx = project();
    const text = (changes: Parameters<typeof writeTokens>[1]) =>
      edited(ctx, changes)[0]?.text ?? "";
    expect(
      text([
        { name: "color-brand", value: "#111" },
        { name: "color-brand", value: "#222222" },
      ])
    ).toBe(APP_CSS.replace("#2563eb", "#222222"));
    expect(
      text([
        { name: "color-brand", remove: true },
        { name: "color-brand", value: "#333333" },
      ])
    ).toBe(APP_CSS.replace("#2563eb", "#333333"));
    const twice = text([
      { name: "color-accent", value: "#444444" },
      { name: "color-accent", value: "#555555" },
    ]);
    expect(twice).toContain("--color-accent: #555555;");
    expect(twice).not.toContain("#444444");
    // Two tokens that share one variable: each takes its own value, and the variable keeps its.
    const shared = project(
      APP_CSS.replace(
        "--color-background: var(--background);",
        "--color-background: var(--background);\n  --color-surface: var(--background);"
      )
    );
    const each =
      edited(shared, [
        { name: "color-background", value: "#fafafa" },
        { name: "color-surface", value: "#f0f0f0" },
      ])[0]?.text ?? "";
    expect(each).toContain("--color-background: #fafafa;");
    expect(each).toContain("--color-surface: #f0f0f0;");
    expect(each).toContain("--background: #ffffff;");
  });

  it("adds a token after the reset of its namespace, which would take it out again", () => {
    const ctx = project(`@import "tailwindcss";
@theme {
  --radius-lg: 0.75rem;
}
@theme {
  --color-*: initial;
  --color-old: #000;
}
`);
    const text =
      edited(ctx, [
        { name: "color-brand", value: "#2563eb" },
        { name: "radius-sm", value: "0.25rem" },
      ])[0]?.text ?? "";
    expect(text).toContain("--color-old: #000;\n  --color-brand: #2563eb;\n}");
    // Nothing resets the radii: the first block still takes them.
    expect(text).toContain("--radius-lg: 0.75rem;\n  --radius-sm: 0.25rem;\n}");
  });

  it("starts a theme block after a reset written in a block of its own", () => {
    const ctx = project(`@import "tailwindcss";
@theme {
  --color-old: #000;
}
@theme inline {
  --color-*: initial;
}
@theme {
  --radius-lg: 0.75rem;
}
`);
    const text =
      edited(ctx, [{ name: "color-brand", value: "#2563eb" }])[0]?.text ?? "";
    expect(text).toContain(
      "--radius-lg: 0.75rem;\n  --color-brand: #2563eb;\n}"
    );
  });

  it("starts a theme block in a stylesheet that has none", () => {
    const ctx = project('@import "tailwindcss";\n');
    const edits = edited(ctx, [
      { name: "color-brand", value: "#2563eb" },
      { name: "color-brand", theme: "dark", value: "#60a5fa" },
    ]);
    const text = edits[0]?.text ?? "";
    expect(text).toContain("@theme {\n  --color-brand: #2563eb;\n}");
    expect(text).toContain(".dark {\n  --color-brand: #60a5fa;\n}");
  });

  it("changes a token declared in :root where it is declared, theme by theme, and adds no @theme block", () => {
    const css = `@import "tailwindcss";
:root {
  --color-panel: #f5f5f5;
}
.dark {
  --color-panel: #18181b;
}
`;
    const ctx = project(css);
    const edits = edited(ctx, [
      { name: "color-panel", value: "#eeeeee" },
      { name: "color-panel", theme: "dark", value: "#111111" },
    ]);
    expect(edits.map((e) => e.file)).toEqual(["src/app.css"]);
    expect(edits[0]?.text).toBe(
      css.replace("#f5f5f5", "#eeeeee").replace("#18181b", "#111111")
    );
  });

  it("writes a :root token's theme value in the theme's block, not in one under a condition", () => {
    const css = `@import "tailwindcss";
:root {
  --color-panel: #f5f5f5;
}
.dark {
  --color-panel: #18181b;
}
@media (min-width: 1024px) {
  .dark {
    --color-panel: #27272a;
  }
}
`;
    const ctx = project(css);
    expect(byName(ctx, "color-panel")?.values).toEqual({ dark: "#18181b" });
    const edits = edited(ctx, [
      { name: "color-panel", theme: "dark", value: "#111111" },
    ]);
    expect(edits[0]?.text).toBe(css.replace("#18181b", "#111111"));
  });

  it("adds a :root token's theme value to the theme's own block, not to one under a condition", () => {
    const css = `@import "tailwindcss";
:root {
  --color-panel: #f5f5f5;
}
@media (min-width: 1024px) {
  .dark {
    --color-panel: #27272a;
  }
}
`;
    const ctx = project(css);
    const edits = edited(ctx, [
      { name: "color-panel", theme: "dark", value: "#111111" },
    ]);
    expect(edits[0]?.text).toBe(
      `${css}\n.dark {\n  --color-panel: #111111;\n}\n`
    );
  });

  it("changes the @theme inline alias of a token :root declares too, the one its utilities draw", () => {
    const css = `@import "tailwindcss";
@theme inline {
  --color-panel: var(--panel);
}
:root {
  --panel: #ffffff;
  --color-panel: #f5f5f5;
}
`;
    const ctx = project(css);
    const edits = edited(ctx, [{ name: "color-panel", value: "#eeeeee" }]);
    expect(edits[0]?.text).toBe(css.replace("#ffffff", "#eeeeee"));
  });

  it("changes the :root declaration of a token over the alias @theme gives it", () => {
    const css = `@import "tailwindcss";
@theme {
  --color-panel: var(--panel);
}
:root {
  --panel: #ffffff;
  --color-panel: #f5f5f5;
}
`;
    const ctx = project(css);
    const edits = edited(ctx, [{ name: "color-panel", value: "#eeeeee" }]);
    expect(edits[0]?.text).toBe(css.replace("#f5f5f5", "#eeeeee"));
  });

  it("takes a token declared in :root out where it is declared", () => {
    const ctx = project(`@import "tailwindcss";
:root {
  --color-panel: #f5f5f5;
  --header-height: 4rem;
}
`);
    const edits = edited(ctx, [{ name: "color-panel", remove: true }]);
    expect(edits[0]?.text).toBe(
      '@import "tailwindcss";\n:root {\n  --header-height: 4rem;\n}\n'
    );
  });

  it("changes the :root value of a token @theme declares too, the one the app draws", () => {
    const css = `@import "tailwindcss";
@theme {
  --color-panel: #ffffff;
}
:root {
  --color-panel: #f5f5f5;
}
`;
    const ctx = project(css);
    const edits = edited(ctx, [{ name: "color-panel", value: "#eeeeee" }]);
    expect(edits[0]?.text).toBe(css.replace("#f5f5f5", "#eeeeee"));
  });

  it("reads back the block it made for a theme named in two words, and writes in it again", () => {
    const ctx = project();
    const file = path.join(ctx.root, "src/app.css");
    const write = (value: string) =>
      writeFileSync(
        file,
        edited(ctx, [{ name: "color-brand", theme: "dark mode", value }])[0]
          ?.text ?? ""
      );
    write("#60a5fa");
    expect(readTokens(ctx).themes).toEqual(["dark", "dark mode"]);
    expect(byName(ctx, "color-brand")?.values).toEqual({
      "dark mode": "#60a5fa",
    });
    write("#93c5fd");
    expect(readFileSync(file, "utf8")).toBe(
      `${APP_CSS}\n[data-theme="dark mode"] {\n  --color-brand: #93c5fd;\n}\n`
    );
  });
});

describe("exporting tokens in the stylesheet's own form (UP-236)", () => {
  const PALETTE = `@import "tailwindcss";
@theme {
  --color-gray-200: #e5e5e5;
  --color-gray-300: #d4d4d4;
  --color-border: var(--color-gray-200);
}
`;

  it("keeps an alias whose variable holds the design's value, and writes nothing", () => {
    const ctx = project(PALETTE);
    const { edits, writes } = writeTokens(ctx, [
      { name: "color-border", value: "#e5e5e5" },
    ]);
    expect(edits).toEqual([]);
    expect(writes).toEqual([
      {
        does: "none",
        file: "src/app.css",
        from: "var(--color-gray-200)",
        name: "color-border",
      },
    ]);
  });

  it("points an alias at the declared step that holds the new value", () => {
    const ctx = project(PALETTE);
    const step = writeTokens(ctx, [{ name: "color-border", value: "#d4d4d4" }]);
    expect(step.edits[0]?.text).toBe(
      PALETTE.replace("var(--color-gray-200);", "var(--color-gray-300);")
    );
    expect(step.writes).toEqual([
      {
        does: "change",
        file: "src/app.css",
        from: "var(--color-gray-200)",
        name: "color-border",
        to: "var(--color-gray-300)",
      },
    ]);
  });

  it("writes the value in place of an alias when no declared variable holds it", () => {
    const ctx = project(PALETTE);
    expect(
      edited(ctx, [{ name: "color-border", value: "#123456" }])[0]?.text
    ).toBe(PALETTE.replace("var(--color-gray-200);", "#123456;"));
  });

  it("repairs a value an earlier export damaged in place, declaring nothing again", () => {
    const css = `@import "tailwindcss";
@import "tw-animate-css";
@theme {
  --animate-accordion-down: accordion-down .2sease-out0s;
}
`;
    const ctx = project(css);
    installed(
      ctx,
      "tw-animate-css",
      "dist/tw-animate.css",
      "@theme inline{--animate-accordion-down:accordion-down var(--tw-duration,.2s)var(--tw-ease,ease-out)}"
    );
    // The damage still reads as the code's value, so Sync shows it differs from the design's.
    expect(byName(ctx, "animate-accordion-down")?.value).toBe(
      "accordion-down .2sease-out0s"
    );
    expect(
      edited(ctx, [
        {
          name: "animate-accordion-down",
          value: "accordion-down .2s ease-out",
        },
      ])
    ).toEqual([
      {
        file: "src/app.css",
        text: css.replace(".2sease-out0s", ".2s ease-out"),
      },
    ]);
  });

  it("never rewrites a palette step through a token that aliases it", () => {
    const css = `@import "tailwindcss";
:root {
  --gray-200: #e5e5e5;
}
@theme inline {
  --color-border: var(--gray-200);
  --color-input: var(--gray-200);
  --color-ring: var(--gray-200);
}
`;
    const ctx = project(css);
    const text =
      edited(ctx, [
        { name: "color-border", value: "#ffffff" },
        { name: "color-ring", value: "#000000" },
      ])[0]?.text ?? "";
    expect(text).toBe(
      css
        .replace("--color-border: var(--gray-200);", "--color-border: #ffffff;")
        .replace("--color-ring: var(--gray-200);", "--color-ring: #000000;")
    );
  });

  it("writes shadcn's per-theme variable through its token's alias, as before", () => {
    const ctx = project();
    const text =
      edited(ctx, [{ name: "color-background", value: "#fafafa" }])[0]?.text ??
      "";
    expect(text).toBe(
      APP_CSS.replace("--background: #ffffff;", "--background: #fafafa;")
    );
  });

  it("reads and writes a token's base value outside the media query that overrides it", () => {
    const css = `@import "tailwindcss";
@theme {
  --text-hero: 2rem;
  --color-brand: #000000;
  --color-primary: var(--primary);
}
:root {
  --primary: #111111;
}
.dark {
  --color-brand: #ffffff;
}
@media (max-width: 640px) {
  :root {
    --text-hero: 1rem;
    --primary: #222222;
  }
}
@media (min-width: 1024px) {
  .dark {
    --color-brand: #eeeeee;
  }
}
`;
    const ctx = project(css);
    expect(byName(ctx, "text-hero")?.value).toBe("2rem");
    expect(byName(ctx, "color-primary")?.value).toBe("#111111");
    expect(byName(ctx, "color-brand")?.values).toEqual({ dark: "#ffffff" });
    const text =
      edited(ctx, [
        { name: "text-hero", value: "3rem" },
        { name: "color-primary", value: "#333333" },
        { name: "color-brand", theme: "dark", value: "#dddddd" },
      ])[0]?.text ?? "";
    expect(text).toBe(
      css
        .replace("--text-hero: 2rem;", "--text-hero: 3rem;")
        .replace("--primary: #111111;", "--primary: #333333;")
        .replace("--color-brand: #ffffff;", "--color-brand: #dddddd;")
    );
  });

  it("adds the tokens the code lacks in one block, in the stylesheet that declares the project's tokens", () => {
    const tokens = `:root {
  --color-panel: #f5f5f5;
  --color-line: #e5e5e5;
}
`;
    const ctx = project('@import "tailwindcss";\n@import "./tokens.css";\n');
    writeFileSync(path.join(ctx.root, "src/tokens.css"), tokens);
    const { edits, writes } = writeTokens(ctx, [
      { name: "color-accent", value: "#f59e0b" },
      { name: "radius-card", value: "0.75rem" },
      { name: "color-accent", theme: "dark", value: "#fbbf24" },
      { name: "radius-card", theme: "dark", value: "1rem" },
    ]);
    expect(edits).toEqual([
      {
        file: "src/tokens.css",
        text: `${tokens}\n@theme {\n  --color-accent: #f59e0b;\n  --radius-card: 0.75rem;\n}\n\n.dark {\n  --color-accent: #fbbf24;\n  --radius-card: 1rem;\n}\n`,
      },
    ]);
    expect(writes.map((w) => [w.name, w.theme, w.does, w.file, w.to])).toEqual([
      ["color-accent", undefined, "add", "src/tokens.css", "#f59e0b"],
      ["radius-card", undefined, "add", "src/tokens.css", "0.75rem"],
      ["color-accent", "dark", "add", "src/tokens.css", "#fbbf24"],
      ["radius-card", "dark", "add", "src/tokens.css", "1rem"],
    ]);
  });

  it("writes a package's token only where the design's value differs from the package's, as the project's own", () => {
    const ctx = project('@import "tailwindcss";\n@import "tw-animate-css";\n');
    installed(
      ctx,
      "tw-animate-css",
      "dist/tw-animate.css",
      "@theme inline{--animate-accordion-down:accordion-down var(--tw-animation-duration,var(--tw-duration,.2s))var(--tw-ease,ease-out)var(--tw-animation-delay,0s)}"
    );
    expect(byName(ctx, "animate-accordion-down")?.value).toBe(
      "accordion-down .2s ease-out 0s"
    );
    const same = writeTokens(ctx, [
      {
        name: "animate-accordion-down",
        value: "accordion-down .2s ease-out 0s",
      },
    ]);
    expect(same.edits).toEqual([]);
    expect(same.writes.map((w) => w.does)).toEqual(["none"]);
    const differs = edited(ctx, [
      {
        name: "animate-accordion-down",
        value: "accordion-down .3s ease-out 0s",
      },
    ]);
    expect(differs).toEqual([
      {
        file: "src/app.css",
        text: '@import "tailwindcss";\n@import "tw-animate-css";\n\n@theme {\n  --animate-accordion-down: accordion-down .3s ease-out 0s;\n}\n',
      },
    ]);
    // The project's override is read back as the token's value: it comes after the import.
    writeFileSync(path.join(ctx.root, "src/app.css"), differs[0]?.text ?? "");
    expect(byName(ctx, "animate-accordion-down")?.value).toBe(
      "accordion-down .3s ease-out 0s"
    );
  });
});
