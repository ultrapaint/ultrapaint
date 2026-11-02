import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { allTokens } from "@ultrapaint/contracts/token-table";
import { describe, expect, it } from "vitest";
import {
  designTokensDocument,
  readDesignTokens,
  serialiseDesignTokens,
  tokensFromDesignTokens,
  tokensOfFile,
} from "./services/dtcg.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  borderWidths: [{ name: "border-width-thin", value: "1px" }],
  colors: [
    {
      name: "Semantic",
      tokens: [
        {
          description: "Buttons and links.",
          name: "color-primary",
          value: "#3b82f6",
          values: { dark: "oklch(0.623 0.214 259.815)" },
        },
        {
          name: "color-primary-foreground",
          value: "oklch(62.3% 0.214 259.815)",
          values: { dark: "#FFF" },
        },
        { name: "color-overlay", value: "rgb(0 0 0 / 0.5)" },
        { name: "color-ring", value: "var(--color-primary)" },
        { name: "color-muted", value: "hsl(210 40% 96.1%)" },
        { name: "color-wide", value: "color(display-p3 1 0.5 0)" },
        { name: "color-current", value: "currentColor" },
      ],
    },
  ],
  layout: { breakpoints: [{ name: "breakpoint-md", value: "48rem" }] },
  motion: {
    animations: [{ name: "animate-spin", value: "spin 1s linear infinite" }],
    durations: [{ name: "duration-fast", value: "150ms" }],
    easings: [
      { name: "ease-out", value: "cubic-bezier(0, 0, 0.2, 1)" },
      { name: "ease-linear", value: "linear" },
    ],
  },
  radius: [{ name: "radius-lg", value: "0.5rem" }],
  shadows: [
    {
      name: "shadow-sm",
      value: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    },
  ],
  spacing: {
    base: "0.25rem",
    tokens: [{ name: "spacing-1.5", value: "calc(var(--spacing) * 1.5)" }],
  },
  themes: ["light", "dark"],
  typography: {
    fonts: [
      {
        name: "font-sans",
        value: 'Inter, ui-sans-serif, system-ui, "Apple Color Emoji"',
      },
      { name: "font-mono", value: "'JetBrains Mono', monospace" },
    ],
    leading: [{ name: "leading-tight", value: "1.25" }],
    sizes: [{ lineHeight: "1.5", name: "text-base", value: "1rem" }],
    styles: [],
    tracking: [{ name: "tracking-wide", value: "0.025em" }],
    weights: [
      { name: "font-weight-bold", value: "700" },
      { name: "font-weight-black", value: "black" },
    ],
  },
};

type Rec = Record<string, unknown>;
const at = (doc: unknown, ...path: string[]): Rec =>
  path.reduce<unknown>((node, key) => (node as Rec)[key], doc) as Rec;
const ext = (token: Rec) => at(token, "$extensions", "dev.ultrapaint");

describe("the Design Tokens export", () => {
  it("reads back every token, in every theme", () => {
    const { notes, tokens } = tokensFromDesignTokens(
      JSON.parse(serialiseDesignTokens(ds))
    );
    expect(notes).toEqual([]);
    const expected = allTokens(ds)
      .map((t) => t.name)
      .flatMap((name) => {
        const token = [
          ...ds.colors.flatMap((g) => g.tokens),
          ...(ds.borderWidths ?? []),
          ...(ds.layout?.breakpoints ?? []),
          ...(ds.motion?.animations ?? []),
          ...(ds.motion?.durations ?? []),
          ...(ds.motion?.easings ?? []),
          ...ds.radius,
          ...ds.shadows,
          ...(ds.spacing.tokens ?? []),
          ...ds.typography.fonts,
          ...(ds.typography.leading ?? []),
          ...ds.typography.sizes,
          ...(ds.typography.tracking ?? []),
          ...ds.typography.weights,
        ].find((t) => t.name === name);
        const value = token?.value ?? ds.spacing.base;
        return [
          { name, value },
          ...Object.entries(token?.values ?? {}).map(([theme, v]) => ({
            name,
            theme,
            value: v,
          })),
        ];
      });
    expect([...tokens].sort(byName)).toEqual(expected.sort(byName));
  });

  it("groups tokens by kind under their names without the prefix", () => {
    const doc = designTokensDocument(ds);
    expect(Object.keys(doc)).toEqual(
      [
        "color",
        "spacing",
        "font-size",
        "font-weight",
        "font-family",
        "leading",
        "tracking",
        "radius",
        "shadow",
        "border-width",
        "duration",
        "easing",
        "animation",
        "breakpoint",
        "$extensions",
      ].sort(groupOrder)
    );
    expect(Object.keys(at(doc, "color"))).toContain("primary-foreground");
    expect(at(doc, "spacing", "$root").$value).toEqual({
      unit: "rem",
      value: 0.25,
    });
    // A dot is not allowed in a name.
    expect(ext(at(doc, "spacing", "1_5")).name).toBe("spacing-1.5");
    expect(at(doc, "$extensions", "dev.ultrapaint")).toEqual({
      format: "2025.10",
      themes: ["light", "dark"],
    });
  });

  it("writes colours as the format's colour values", () => {
    const doc = designTokensDocument(ds);
    const primary = at(doc, "color", "primary");
    expect(primary.$type).toBe("color");
    expect(primary.$description).toBe("Buttons and links.");
    expect(primary.$value).toEqual({
      colorSpace: "srgb",
      components: [0.2314, 0.5098, 0.9647],
      hex: "#3b82f6",
    });
    // The hex says the CSS exactly, so it is not kept as well.
    expect(ext(primary).css).toBeUndefined();
    expect(at(ext(primary), "themes", "dark")).toMatchObject({
      colorSpace: "oklch",
      components: [0.623, 0.214, 259.815],
    });

    const foreground = at(doc, "color", "primary-foreground");
    expect(foreground.$value).toMatchObject({
      colorSpace: "oklch",
      components: [0.623, 0.214, 259.815],
    });
    expect(ext(foreground).css).toBe("oklch(62.3% 0.214 259.815)");
    expect(at(ext(foreground), "themesCss")).toEqual({ dark: "#FFF" });

    expect(at(doc, "color", "overlay").$value).toEqual({
      alpha: 0.5,
      colorSpace: "srgb",
      components: [0, 0, 0],
      hex: "#000000",
    });
    expect(at(doc, "color", "muted").$value).toMatchObject({
      colorSpace: "hsl",
      components: [210, 40, 96.1],
    });
    // Every space has sRGB's hex beside, clamped into its gamut.
    expect(at(doc, "color", "wide").$value).toEqual({
      colorSpace: "display-p3",
      components: [1, 0.5, 0],
      hex: "#ff7600",
    });
    // A `var()` of another token is an alias of it.
    expect(at(doc, "color", "ring").$value).toBe("{color.primary}");
  });

  it("writes dimensions, durations, weights, fonts and curves", () => {
    const doc = designTokensDocument(ds);
    expect(at(doc, "radius", "lg")).toMatchObject({
      $type: "dimension",
      $value: { unit: "rem", value: 0.5 },
    });
    expect(at(doc, "font-size", "base")).toMatchObject({
      $type: "dimension",
      $value: { unit: "rem", value: 1 },
    });
    expect(ext(at(doc, "font-size", "base")).lineHeight).toBe("1.5");
    expect(at(doc, "duration", "fast")).toMatchObject({
      $type: "duration",
      $value: { unit: "ms", value: 150 },
    });
    expect(at(doc, "font-weight", "bold").$value).toBe(700);
    expect(at(doc, "font-weight", "black").$value).toBe("black");
    expect(at(doc, "leading", "tight")).toMatchObject({
      $type: "number",
      $value: 1.25,
    });
    expect(at(doc, "font-family", "sans")).toMatchObject({
      $type: "fontFamily",
      $value: ["Inter", "ui-sans-serif", "system-ui", "Apple Color Emoji"],
    });
    expect(ext(at(doc, "font-family", "sans")).css).toBeUndefined();
    expect(at(doc, "font-family", "mono").$value).toEqual([
      "JetBrains Mono",
      "monospace",
    ]);
    expect(ext(at(doc, "font-family", "mono")).css).toBe(
      "'JetBrains Mono', monospace"
    );
    expect(at(doc, "easing", "out")).toMatchObject({
      $type: "cubicBezier",
      $value: [0, 0, 0.2, 1],
    });
  });

  it("keeps what the format has no type for as CSS", () => {
    const doc = designTokensDocument(ds);
    for (const token of [
      at(doc, "shadow", "sm"),
      at(doc, "animation", "spin"),
      at(doc, "easing", "linear"),
      at(doc, "tracking", "wide"),
      at(doc, "spacing", "1_5"),
      at(doc, "color", "current"),
    ]) {
      expect(token.$type).toBeUndefined();
      expect(typeof token.$value).toBe("string");
      expect(ext(token).css).toBe(token.$value);
    }
  });

  it("is serialised the same way every time", () => {
    const text = serialiseDesignTokens(ds);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "color": {\n    "primary": {\n      "$type"');
    expect(serialiseDesignTokens(ds)).toBe(text);
    // The themes are written in the design system's order, however a token lists them.
    const themed = (values: Record<string, string>): DesignSystem => ({
      ...ds,
      colors: [
        { name: "x", tokens: [{ name: "color-x", value: "#000000", values }] },
      ],
    });
    const entries: [string, string][] = [
      ["dark", "#ffffff"],
      ["light", "#eeeeee"],
    ];
    const darkFirst = themed(Object.fromEntries(entries));
    const lightFirst = themed(Object.fromEntries(entries.toReversed()));
    expect(serialiseDesignTokens(darkFirst)).toBe(
      serialiseDesignTokens(lightFirst)
    );
    const x = at(designTokensDocument(darkFirst), "color", "x");
    expect(Object.keys(at(ext(x), "themes"))).toEqual(["light", "dark"]);
  });

  it("lets another tool's change of a value win over the CSS kept beside it", () => {
    const doc = designTokensDocument(ds) as Rec;
    const foreground = at(doc, "color", "primary-foreground");
    foreground.$value = {
      colorSpace: "srgb",
      components: [1, 0, 0],
      hex: "#ff0000",
    };
    const { tokens } = tokensFromDesignTokens(doc);
    expect(
      tokens.find((t) => t.name === "color-primary-foreground" && !t.theme)
        ?.value
    ).toBe("#ff0000");
  });
});

describe("reading another tool's Design Tokens", () => {
  it("names tokens by their paths and resolves aliases", () => {
    const { notes, tokens } = tokensFromDesignTokens({
      colors: {
        $type: "color",
        accent: { $value: { $ref: "#/colors/blue/500/$value" } },
        blue: {
          500: {
            $value: { colorSpace: "srgb", components: [0, 0.4, 0.8] },
          },
        },
        brand: { $value: "{colors.blue.500}" },
        missing: { $value: "{colors.red.500}" },
        wide: {
          $value: {
            alpha: 0.5,
            colorSpace: "oklch",
            components: [0.7, 0.1, "none"],
          },
        },
      },
      elevation: {
        raised: {
          $type: "shadow",
          $value: {
            blur: { unit: "px", value: 4 },
            color: "{colors.blue.500}",
            offsetX: { unit: "px", value: 0 },
            offsetY: { unit: "px", value: 2 },
            spread: { unit: "px", value: 0 },
          },
        },
      },
      font: {
        body: { $type: "fontFamily", $value: ["Open Sans", "sans-serif"] },
      },
      heading: {
        $type: "typography",
        $value: { fontFamily: "{font.body}", fontSize: "{size.small}" },
      },
      motion: {
        quick: { $type: "duration", $value: { unit: "s", value: 0.2 } },
        swift: { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
      },
      size: {
        $type: "dimension",
        small: { $value: { unit: "px", value: 8 } },
      },
      spacing: {
        $root: { $type: "dimension", $value: { unit: "rem", value: 0.25 } },
      },
    });
    expect([...tokens].sort(byName)).toEqual(
      [
        { name: "color-blue-500", value: "rgb(0 102 204)" },
        { name: "color-brand", value: "rgb(0 102 204)" },
        { name: "color-accent", value: "rgb(0 102 204)" },
        { name: "color-wide", value: "oklch(0.7 0.1 none / 0.5)" },
        { name: "spacing", value: "0.25rem" },
        { name: "font-body", value: '"Open Sans", sans-serif' },
        { name: "duration-motion-quick", value: "0.2s" },
        { name: "ease-motion-swift", value: "cubic-bezier(0.4, 0, 0.2, 1)" },
        {
          name: "shadow-elevation-raised",
          value: "0px 2px 4px 0px rgb(0 102 204)",
        },
      ].sort(byName)
    );
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain("{colors.red.500} is no token");
    expect(notes[1]).toContain("typography");
    expect(notes[2]).toContain("`size.small`");
  });

  it("takes the kind a token's type says over its path's words, and the path's for a dimension", () => {
    const { notes, tokens } = tokensFromDesignTokens({
      Corner: { sm: { $type: "dimension", $value: { unit: "px", value: 4 } } },
      font: {
        size: {
          sm: { $type: "dimension", $value: { unit: "rem", value: 0.875 } },
        },
      },
      radius: { card: { $type: "number", $value: 12 } },
      text: {
        primary: { $type: "color", $value: "#111111" },
        secondary: { $value: "{text.primary}" },
      },
    });
    expect([...tokens].sort(byName)).toEqual(
      [
        { name: "color-text-primary", value: "#111111" },
        { name: "color-text-secondary", value: "#111111" },
        { name: "radius-card", value: "12px" },
        { name: "radius-sm", value: "4px" },
        { name: "text-sm", value: "0.875rem" },
      ].sort(byName)
    );
    expect(notes).toEqual([]);
  });

  it("notes an alias that refers back to itself, and a file that is not one", () => {
    const { notes, tokens } = tokensFromDesignTokens({
      color: {
        a: { $type: "color", $value: "{color.b}" },
        b: { $type: "color", $value: "{color.a}" },
      },
    });
    expect(tokens).toEqual([]);
    expect(notes.some((n) => n.includes("refers back to itself"))).toBe(true);
    expect(tokensFromDesignTokens([]).notes).toHaveLength(1);
  });
});

const byName = (a: { name: string; theme?: string }, b: typeof a) =>
  `${a.name}@${a.theme ?? ""}`.localeCompare(`${b.name}@${b.theme ?? ""}`);

const GROUPS = [
  "color",
  "spacing",
  "font-size",
  "font-weight",
  "font-family",
  "leading",
  "tracking",
  "radius",
  "shadow",
  "border-width",
  "breakpoint",
  "container",
  "easing",
  "duration",
  "animation",
  "other",
  "$extensions",
];
const groupOrder = (a: string, b: string) =>
  GROUPS.indexOf(a) - GROUPS.indexOf(b);

describe("design.tokens.json as a Sync source", () => {
  it("reads the export back as the design system's tokens, a theme's values with each", () => {
    const read = readDesignTokens(serialiseDesignTokens(ds));
    if ("problem" in read) {
      throw new Error(read.problem);
    }
    const primary = read.tokens.find((t) => t.name === "color-primary");
    expect(primary).toEqual({
      kind: "color",
      name: "color-primary",
      own: true,
      value: "#3b82f6",
      values: { dark: "oklch(0.623 0.214 259.815)" },
    });
  });

  it("says why a file is no Design Tokens file", () => {
    const read = readDesignTokens("{ not json");
    expect("problem" in read && read.problem).toContain(
      "design.tokens.json is not JSON"
    );
    expect(
      tokensOfFile([
        { name: "color-a", theme: "dark", value: "#000" },
        { name: "color-a", value: "#fff" },
      ])
    ).toEqual([{ kind: "color", name: "color-a", own: true, value: "#fff" }]);
  });
});
