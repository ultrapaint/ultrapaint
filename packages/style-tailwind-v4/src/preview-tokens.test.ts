import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import type { DesignSystemContext } from "@ultrapaint/framework-api/node";
import { afterAll, describe, expect, it } from "vitest";
import { previewTokenCss } from "./preview-tokens.ts";

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
}

@theme inline {
  --color-primary: var(--primary);
  --color-background: var(--background);
}

:root {
  --primary: oklch(0.6 0.2 260);
  --background: #ffffff;
}

.dark {
  --primary: oklch(0.8 0.1 260);
}
`;

/** A repository whose preview imports `src/app.css`, as the settings name it. */
const project = (css = APP_CSS): DesignSystemContext => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-preview-tokens-"));
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

describe("the design's token values in the preview", () => {
  it("sets an alias's variable under each theme's selector, and a @theme token on :root", () => {
    const css = previewTokenCss(project(), [
      { name: "color-primary", value: "#ff0000" },
      { name: "color-primary", theme: "dark", value: "#ff8888" },
      { name: "color-brand", value: "#111111" },
      { name: "radius-lg", value: "1rem" },
    ]);
    expect(css).toBe(`:root {
  --color-brand: #111111;
  --primary: #ff0000;
  --radius-lg: 1rem;
}

.dark {
  --primary: #ff8888;
}
`);
  });

  it("declares a token the code does not have, in the default theme and in a theme", () => {
    const css = previewTokenCss(project(), [
      { name: "color-accent", value: "#f59e0b" },
      { name: "color-accent", theme: "dark", value: "#fbbf24" },
      { name: "color-accent", theme: "ocean", value: "#0ea5e9" },
    ]);
    expect(css).toBe(`:root {
  --color-accent: #f59e0b;
}

.dark {
  --color-accent: #fbbf24;
}

[data-theme="ocean"] {
  --color-accent: #0ea5e9;
}
`);
  });

  it("keeps the code's value of a theme the design gives none, so the default's rule does not win there", () => {
    const css = previewTokenCss(project(), [
      { name: "color-primary", value: "#ff0000" },
    ]);
    expect(css).toBe(`:root {
  --primary: #ff0000;
}

.dark {
  --primary: oklch(0.8 0.1 260);
}
`);
  });

  it("leaves out empty values, and takes the last of two for one variable", () => {
    expect(
      previewTokenCss(project(), [
        { name: "color-brand", value: "  " },
        { name: "radius-lg", value: "" },
      ])
    ).toBe("");
    expect(
      previewTokenCss(project(), [
        { name: "color-background", value: "#000" },
        { name: "color-background", value: "#fafafa" },
      ])
    ).toBe(":root {\n  --background: #fafafa;\n}\n");
  });

  it("writes under the code's own selectors, out of its layer and inside its media query", () => {
    const ctx = project(`@import "tailwindcss";
@theme inline {
  --color-primary: var(--primary);
  --color-muted: var(--muted);
}
@layer base {
  :root, :host {
    --primary: #000;
    --muted: #eee;
  }
}
[data-theme="ocean"] {
  --muted: #cde;
}
@media (prefers-color-scheme: dark) {
  :root {
    --primary: #fff;
  }
}
`);
    const css = previewTokenCss(ctx, [
      { name: "color-primary", value: "#111" },
      { name: "color-primary", theme: "dark", value: "#eee" },
      { name: "color-muted", theme: "ocean", value: "#abc" },
    ]);
    // The themes come in the order the code has them.
    expect(css).toBe(`:root, :host {
  --primary: #111;
}

[data-theme="ocean"] {
  --muted: #abc;
}

@media (prefers-color-scheme: dark) {
  :root {
    --primary: #eee;
  }
}
`);
  });

  it("gives a theme's new value the selector of the block the code has for it", () => {
    const ctx = project(`@import "tailwindcss";
@theme {
  --color-brand: #2563eb;
}
:root { --background: #fff; }
.dark, [data-theme="dark"] { --background: #000; }
`);
    expect(
      previewTokenCss(ctx, [
        { name: "color-brand", theme: "dark", value: "#60a5fa" },
      ])
    ).toBe('.dark, [data-theme="dark"] {\n  --color-brand: #60a5fa;\n}\n');
  });
});
