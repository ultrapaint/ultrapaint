import { resolveVars } from "@ultrapaint/contracts/token-value";
import { describe, expect, it } from "vitest";
import {
  applyThemeDeclaration,
  masked,
  parseStylesheet,
} from "./stylesheet.ts";

const declared = (css: string) =>
  parseStylesheet("a.css", css).declarations.map(
    (d) => `${d.prelude} | ${d.name}: ${d.value}`
  );

describe("reading a stylesheet", () => {
  it("keeps a quoted `;` or `}` inside its value", () => {
    const css = `:root {
  --icon: url("data:image/svg+xml;utf8,<svg fill='%23fff'>}</svg>");
  --after: 1px;
}`;
    expect(declared(css)).toEqual([
      `:root | --icon: url("data:image/svg+xml;utf8,<svg fill='%23fff'>}</svg>")`,
      ":root | --after: 1px",
    ]);
  });

  it("reads resets, plain properties, `!important` and nested blocks with their outer prelude", () => {
    const css = `@theme { --color-*: initial; --*: initial; }
@layer base { .card { margin-top: -16px !important; &:hover { color: red } } }`;
    expect(declared(css)).toEqual([
      "@theme | --color-*: initial",
      "@theme | --*: initial",
      "@layer base .card | margin-top: -16px !important",
      "@layer base .card &:hover | color: red",
    ]);
  });

  it("tells at-rule statements from declarations, and skips comments", () => {
    const css = `.a { /* color: blue; */ @apply px-4 text-sm; color: "/* not a comment */"; }`;
    const parsed = parseStylesheet("a.css", css);
    expect(parsed.statements).toEqual([
      expect.objectContaining({ name: "apply", params: "px-4 text-sm" }),
    ]);
    const [apply] = parsed.statements;
    expect(css.slice(apply?.paramsStart, (apply?.paramsStart ?? 0) + 12)).toBe(
      "px-4 text-sm"
    );
    expect(parsed.declarations.map((d) => d.value)).toEqual([
      '"/* not a comment */"',
    ]);
    expect(masked("a /* b\nc */ d")).toBe("a     \n     d");
  });

  it("steps over escaped characters in selectors", () => {
    expect(declared(".foo\\( { color: red } :root { --x: 1 }")).toEqual([
      ".foo\\( | color: red",
      ":root | --x: 1",
    ]);
    expect(declared(".it\\'s { color: red } :root { --x: 1 }")).toEqual([
      ".it\\'s | color: red",
      ":root | --x: 1",
    ]);
    expect(masked(".a\\/* b */ {}")).toBe(".a\\/* b */ {}");
  });

  it("reads a value without its comments, keeping where it is written", () => {
    const css = `:root {
  --color-bg: var(--background /* light */);
  --font-sans: "Inter" /* main */, sans-serif;
  --gap: /* none yet */ 4px;
}`;
    const parsed = parseStylesheet("a.css", css);
    expect(parsed.declarations.map((d) => d.value)).toEqual([
      "var(--background)",
      '"Inter", sans-serif',
      "4px",
    ]);
    const [bg] = parsed.declarations;
    expect(css.slice(bg?.valueStart, bg?.valueEnd)).toBe(
      "var(--background /* light */)"
    );
    expect(
      resolveVars(bg?.value ?? "", (v) =>
        v === "--background" ? "#fff" : undefined
      )
    ).toBe("#fff");
  });
});

describe("a theme's resets", () => {
  it("clear a namespace as Tailwind does, keeping the namespaces it keeps", () => {
    const vars = new Map([
      ["--color-red-500", "red"],
      ["--font-sans", "Inter"],
      ["--font-weight-bold", "700"],
      ["--inset-shadow-sm", "x"],
      ["--inset-1", "4px"],
      ["--radius-lg", "8px"],
    ]);
    applyThemeDeclaration(vars, "--color-*", "initial");
    applyThemeDeclaration(vars, "--font-*", "initial");
    applyThemeDeclaration(vars, "--inset-*", "initial");
    applyThemeDeclaration(vars, "--radius-lg", "initial");
    applyThemeDeclaration(vars, "--color-brand", "#123456");
    expect([...vars.keys()]).toEqual([
      "--font-weight-bold",
      "--inset-shadow-sm",
      "--color-brand",
    ]);
    applyThemeDeclaration(vars, "--*", "initial");
    expect(vars.size).toBe(0);
  });
});
