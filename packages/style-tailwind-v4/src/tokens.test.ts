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
      hostCss: ["../../src/app.css"],
    },
  };
};

const byName = (ctx: DesignSystemContext, name: string) =>
  readTokens(ctx).tokens.find((t) => t.name === name);

describe("reading Tailwind v4 tokens", () => {
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
    const edits = writeTokens(ctx, [
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
    const edits = writeTokens(ctx, [
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

  it("takes the last of two changes to one value, whether to the token or the variable it names", () => {
    const ctx = project();
    const text = (changes: Parameters<typeof writeTokens>[1]) =>
      writeTokens(ctx, changes)[0]?.text ?? "";
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
    // Two tokens that are one variable: the last change is the variable's.
    const shared = project(
      APP_CSS.replace(
        "--color-background: var(--background);",
        "--color-background: var(--background);\n  --color-surface: var(--background);"
      )
    );
    const edited = writeTokens(shared, [
      { name: "color-background", value: "#fafafa" },
      { name: "color-surface", value: "#f0f0f0" },
    ]);
    expect(edited[0]?.text).toContain("--background: #f0f0f0;");
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
      writeTokens(ctx, [
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
      writeTokens(ctx, [{ name: "color-brand", value: "#2563eb" }])[0]?.text ??
      "";
    expect(text).toContain(
      "--radius-lg: 0.75rem;\n  --color-brand: #2563eb;\n}"
    );
  });

  it("starts a theme block in a stylesheet that has none", () => {
    const ctx = project('@import "tailwindcss";\n');
    const edits = writeTokens(ctx, [
      { name: "color-brand", value: "#2563eb" },
      { name: "color-brand", theme: "dark", value: "#60a5fa" },
    ]);
    const text = edits[0]?.text ?? "";
    expect(text).toContain("@theme {\n  --color-brand: #2563eb;\n}");
    expect(text).toContain(".dark {\n  --color-brand: #60a5fa;\n}");
  });

  it("reads back the block it made for a theme named in two words, and writes in it again", () => {
    const ctx = project();
    const file = path.join(ctx.root, "src/app.css");
    const write = (value: string) =>
      writeFileSync(
        file,
        writeTokens(ctx, [
          { name: "color-brand", theme: "dark mode", value },
        ])[0]?.text ?? ""
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
