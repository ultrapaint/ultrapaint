import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { mappingKey } from "@ultrapaint/contracts/design-system-setup";
import type { UsageContext } from "@ultrapaint/framework-api/node";
import { describe, expect, it } from "vitest";
import { usage } from "./usage-rewrite.ts";

const designSystem: DesignSystem = {
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#3b82f6" },
        { name: "color-muted-foreground", value: "#71717a" },
      ],
    },
  ],
  elevation: [{ layer: 50, name: "Overlay" }],
  radius: [
    { name: "radius-sm", value: "0.25rem" },
    { name: "radius-lg", value: "0.5rem" },
  ],
  shadows: [{ name: "shadow-md", value: "0 4px 6px rgb(0 0 0 / 0.1)" }],
  spacing: { base: "0.25rem" },
  typography: {
    fonts: [],
    sizes: [{ name: "text-sm", value: "0.875rem" }],
    styles: [],
    weights: [{ name: "font-weight-semibold", value: "600" }],
  },
  version: 1,
};

const ctx: UsageContext = {
  components: ["Button"],
  designSystem,
  libraryDirs: ["src/ui"],
  ownTokens: null,
};

const mapping = new Map<string, string | null>([
  [mappingKey("color", "#3b82f6"), "color-primary"],
  [mappingKey("color", "color-gray-500"), "color-muted-foreground"],
  [mappingKey("color", "#333333"), "color-primary"],
  [mappingKey("color", "#cccccc"), "color-muted-foreground"],
  [mappingKey("spacing", "13px"), "spacing-3"],
  [mappingKey("spacing", "-10px"), "spacing-2.5"],
  [mappingKey("spacing", "12px"), "spacing-3"],
  [mappingKey("spacing", "4px"), "spacing-1"],
  [mappingKey("radius", "6px"), "radius-sm"],
  [mappingKey("fontSize", "14px"), "text-sm"],
  [mappingKey("zIndex", "999"), "50"],
  [mappingKey("element", "button"), "Button"],
  // Kept as it is: the brand's own orange.
  [mappingKey("color", "#d97757"), null],
]);

describe("rewriting a file onto the design system", () => {
  it("rewrites classes, keeping their variants, importance, sign and opacity", () => {
    const text = `export const A = () => (
  <div className={cn("hover:bg-[#3B82F6]/50 !p-[13px] top-[-10px] -mt-[13px]", "text-gray-500 rounded-[6px] text-[14px] z-[999] bg-[#d97757]")} />
);
`;
    const out = usage.rewrite("src/a.tsx", text, ctx, mapping);
    expect(out.text).toContain(
      `cn("hover:bg-primary/50 !p-3 -top-2.5 -mt-3", "text-muted-foreground rounded-sm text-sm z-50 bg-[#d97757]")`
    );
    expect(out.changes).toBe(8);
    expect(out.left).toEqual([]);
  });

  it("rewrites inline styles and stylesheet declarations onto variables", () => {
    const tsx = `export const A = () => <div style={{ color: "#333", padding: 12, zIndex: 999 }} />;
`;
    const out = usage.rewrite("src/a.tsx", tsx, ctx, mapping);
    expect(out.text).toContain(
      `style={{ color: "var(--color-primary)", padding: "calc(var(--spacing) * 3)", zIndex: 50 }}`
    );
    const css = `.card {
  border: 1px solid #ccc;
  padding: 14px 4px;
  @apply rounded-[6px];
}
`;
    const sheet = usage.rewrite("src/a.css", css, ctx, mapping);
    expect(sheet.text).toBe(`.card {
  border: 1px solid var(--color-muted-foreground);
  padding: 14px --spacing(1);
  @apply rounded-sm;
}
`);
    // 14px is a type size in the mapping, not a spacing value: it stays, and is undecided.
    expect(sheet.left).toEqual([
      {
        kind: "spacing",
        line: 3,
        raw: "padding: 14px 4px",
        value: "14px",
      },
    ]);
  });

  it("keeps a negative value negative, in a stylesheet and in a style", () => {
    const negative = new Map([
      ...mapping,
      [mappingKey("spacing", "-16px"), "spacing-4"],
      [mappingKey("spacing", "16px"), "spacing-4"],
      [mappingKey("radius", "-6px"), "radius-sm"],
    ]);
    const css = `.a {
  margin-top: -16px;
  margin: 16px -16px !important;
}
`;
    const sheet = usage.rewrite("src/a.css", css, ctx, negative);
    expect(sheet.text).toBe(`.a {
  margin-top: calc(--spacing(4) * -1);
  margin: --spacing(4) calc(--spacing(4) * -1) !important;
}
`);
    const tsx = `export const A = () => <div style={{ marginTop: -16, marginLeft: "-16px", padding: 16 }} />;
`;
    const inline = usage.rewrite("src/a.tsx", tsx, ctx, negative);
    expect(inline.text).toContain(
      `style={{ marginTop: "calc(var(--spacing) * -4)", marginLeft: "calc(var(--spacing) * -4)", padding: "calc(var(--spacing) * 4)" }}`
    );
    expect(inline.changes).toBe(3);
  });

  it("leaves what is not mechanical to the agent, with what the mapping says", () => {
    const text = `const COLORS = ["#3b82f6"];
export const A = () => <button onClick={go}>Go</button>;
`;
    const out = usage.rewrite("src/a.tsx", text, ctx, mapping);
    expect(out.changes).toBe(0);
    expect(out.text).toBe(text);
    expect(out.left).toEqual([
      {
        kind: "color",
        line: 1,
        raw: "#3b82f6",
        target: "color-primary",
        value: "#3b82f6",
      },
      {
        kind: "element",
        line: 2,
        raw: "<button>",
        target: "Button",
        value: "button",
      },
    ]);
  });

  it("does not touch a string with an escape, whose text is not where it reads", () => {
    const text = `const a = "bg-[#3b82f6] \\u0070-4";\n`;
    const out = usage.rewrite("src/a.ts", text, ctx, mapping);
    expect(out.text).toBe(text);
    expect(out.left.map((l) => l.target)).toEqual(["color-primary"]);
  });
});

describe("the rules of the mapping", () => {
  it("settles exact matches only", () => {
    const value = (
      kind: Parameters<typeof mappingKey>[0],
      v: string,
      token?: string
    ) => ({
      count: 1,
      examples: [],
      files: 1,
      kind,
      locations: [],
      status: "raw" as const,
      value: v,
      ...(token && { token }),
    });
    const suggested = usage.suggest(
      [
        value("color", "#3b82f6", "color-primary"),
        value("color", "#3b82f7"),
        value("spacing", "16px"),
        value("spacing", "-10px"),
        value("spacing", "13px"),
        value("radius", "0.5rem"),
        value("fontSize", "14px"),
        value("fontWeight", "600"),
        value("zIndex", "50"),
        value("zIndex", "999"),
        value("shadow", "0 4px  6px rgb(0 0 0 / 0.1)"),
        value("element", "button", "Button"),
      ],
      designSystem
    );
    expect(suggested.map((s) => `${s.kind} ${s.value} → ${s.target}`)).toEqual([
      "color #3b82f6 → color-primary",
      "spacing 16px → spacing-4",
      "spacing -10px → spacing-2.5",
      "radius 0.5rem → radius-lg",
      "fontSize 14px → text-sm",
      "fontWeight 600 → font-weight-semibold",
      "zIndex 50 → 50",
      "shadow 0 4px  6px rgb(0 0 0 / 0.1) → shadow-md",
      "element button → Button",
    ]);
  });
});
