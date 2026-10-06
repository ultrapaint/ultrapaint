import { describe, expect, it } from "vitest";
import {
  applyThemeDeclaration,
  masked,
  parseStylesheet,
  resolveVars,
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

describe("following var()", () => {
  const vars = new Map([
    ["--known", "1px"],
    ["--alias", "var(--known)"],
    ["--a", "var(--b)"],
    ["--b", "var(--a, 2px)"],
  ]);
  const resolve = (value: string) => resolveVars(value, (n) => vars.get(n));

  it("resolves each reference on its own, an unknown one included", () => {
    expect(resolve("var(--unknown) var(--known)")).toBe("var(--unknown) 1px");
    expect(resolve("var(--alias) var(--alias) var(--alias)")).toBe(
      "1px 1px 1px"
    );
    expect(resolve("var(--unknown, var(--alias))")).toBe("1px");
    expect(resolve("var(--unknown, rgb(0 0 0 / 0.5))")).toBe(
      "rgb(0 0 0 / 0.5)"
    );
  });

  it("ends a cycle at the fallback, or leaves the reference as written", () => {
    expect(resolve("var(--a)")).toBe("2px");
    const loop = new Map([
      ["--x", "var(--y)"],
      ["--y", "var(--x)"],
    ]);
    expect(resolveVars("var(--x)", (n) => loop.get(n))).toBe("var(--x)");
  });

  it("follows a variable once however often it is met, and stops a value growing without end", () => {
    const fanOut = new Map(
      Array.from({ length: 60 }, (_, i) => [
        `--f${i}`,
        `var(--f${i + 1}) var(--f${i + 1})`,
      ])
    );
    fanOut.set("--f60", "1px");
    let lookups = 0;
    const out = resolveVars("var(--f0)", (n) => {
      lookups += 1;
      return fanOut.get(n);
    });
    expect(lookups).toBe(61);
    expect(out.startsWith("1px 1px 1px")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(10_000);
  });

  it("goes deeper than a fixed number of steps", () => {
    const chain = new Map(
      Array.from({ length: 30 }, (_, i) => [`--v${i}`, `var(--v${i + 1})`])
    );
    chain.set("--v30", "end");
    expect(resolveVars("var(--v0)", (n) => chain.get(n))).toBe("end");
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
