import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { UsageContext } from "@ultrapaint/framework-api/node";
import { describe, expect, it } from "vitest";
import { usage } from "./usage-rewrite.ts";
import { readClass } from "./usage-scan.ts";

const designSystem: DesignSystem = {
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#3b82f6" },
        { name: "color-background", value: "#ffffff" },
      ],
    },
  ],
  elevation: [{ layer: 50, name: "Overlay" }],
  radius: [{ name: "radius-lg", value: "0.5rem" }],
  shadows: [{ name: "shadow-md", value: "0 4px 6px rgb(0 0 0 / 0.1)" }],
  spacing: { base: "0.25rem" },
  typography: {
    fonts: [],
    sizes: [{ name: "text-sm", value: "0.875rem" }],
    styles: [],
    weights: [{ name: "font-weight-bold", value: "700" }],
  },
  version: 1,
};

const saved: UsageContext = {
  components: ["Button", "Checkbox"],
  designSystem,
  libraryDirs: ["src/components/ui"],
  ownTokens: null,
};

const inventoryOf = (
  files: Record<string, string>,
  ctx: UsageContext = saved
) =>
  usage.summarise(
    Object.entries(files).map(([file, text]) => ({
      file,
      uses: usage.scanFile(file, text),
    })),
    ctx,
    0
  );

const valuesOf = (files: Record<string, string>, ctx?: UsageContext) =>
  inventoryOf(files, ctx).values.map(
    (v) =>
      `${v.kind} ${v.status} ${v.value}${v.token ? ` → ${v.token}` : ""} ×${v.count}`
  );

describe("reading a class", () => {
  it("takes the variants, the importance and the opacity off", () => {
    expect(readClass("hover:md:bg-blue-500/50")).toEqual({
      use: "bg",
      value: "blue-500",
    });
    expect(readClass("!px-4")).toEqual({ use: "px", value: "4" });
    expect(readClass("-mt-2")).toEqual({ use: "mt", value: "2" });
    expect(readClass("[&>svg]:rounded-t-lg")).toEqual({
      use: "rounded-t",
      value: "lg",
    });
    expect(readClass("data-[state=open]:bg-[#FFF]")).toEqual({
      use: "bg",
      value: "[#FFF]",
    });
    expect(readClass("left-1/2")).toEqual({ use: "left", value: "1/2" });
    expect(readClass("flex")).toBeNull();
    expect(readClass("toggle-x")).toBeNull();
  });
});

describe("the inventory of a project's code", () => {
  it("sorts classes into the design system's, Tailwind's and values written out", () => {
    const values = valuesOf({
      "src/app.tsx": `export const App = () => (
  <div className={cn("bg-primary text-sm p-4 hover:bg-blue-500", "bg-[#3B82F6] p-[13px] text-[15px] rounded-lg rounded-[6px] shadow-md z-50 z-[999] font-bold font-[550]")}>
    <p className="text-gray-500 text-left mx-auto">Hi</p>
  </div>
);`,
    });
    expect(values).toEqual(
      expect.arrayContaining([
        "color system color-primary → color-primary ×1",
        "color default color-blue-500 → color-blue-500 ×1",
        "color default color-gray-500 → color-gray-500 ×1",
        "color raw #3b82f6 → color-primary ×1",
        "fontSize system text-sm → text-sm ×1",
        "fontSize raw 15px ×1",
        "spacing system spacing 4 ×1",
        "spacing raw 13px ×1",
        "radius system radius-lg → radius-lg ×1",
        "radius raw 6px ×1",
        "shadow system shadow-md → shadow-md ×1",
        "zIndex system 50 ×1",
        "zIndex raw 999 ×1",
        "fontWeight system font-weight-bold → font-weight-bold ×1",
        "fontWeight raw 550 ×1",
      ])
    );
    // text-left, mx-auto and flex are not values of a design system.
    expect(values).toHaveLength(15);
  });

  it("reads inline styles, colour constants and the stylesheets outside the theme", () => {
    const values = valuesOf({
      "src/card.tsx": `export const Card = () => <div style={{ padding: 12, color: "#333", zIndex: 10, fontWeight: 600 }} />;`,
      "src/chart.ts": `export const COLORS = ["#ff0000", "rgb(0 0 0 / 50%)"];`,
      "src/styles.css": `@theme {
  --color-brand: #123456;
}
:root { --background: #fff; }
/* color: #abcdef; */
.card {
  background-color: var(--color-primary);
  border: 1px solid #ccc;
  padding: 0 13px;
  @apply rounded-lg;
}`,
    });
    expect(values).toEqual(
      expect.arrayContaining([
        "color raw #ff0000 ×1",
        "color raw rgb(0 0 0 / 50%) ×1",
        "color raw #333333 ×1",
        "color raw #cccccc ×1",
        "color system color-primary → color-primary ×1",
        "spacing raw 12px ×1",
        "spacing raw 13px ×1",
        "zIndex raw 10 ×1",
        "fontWeight raw 600 ×1",
        "radius system radius-lg → radius-lg ×1",
      ])
    );
    // Nothing from the @theme block, the custom properties or the comment.
    expect(values.some((v) => v.includes("123456"))).toBe(false);
    expect(values.some((v) => v.includes("abcdef"))).toBe(false);
    expect(values.some((v) => v.includes("#ffffff"))).toBe(false);
  });

  it("reads a stylesheet's quoted values whole, and where each declaration is", () => {
    const css = `.icon {
  background: url("data:image/svg+xml;utf8,<svg fill='%23fff'/>");
  margin-top: 13px;
}
a:hover { color: #abcdef; }`;
    const uses = usage.scanFile("src/a.css", css);
    expect(uses.map((u) => `${u.line} ${u.raw}`)).toEqual([
      `2 background: url("data:image/svg+xml;utf8,<svg fill='%23fff'/>")`,
      "3 margin-top: 13px",
      "5 color: #abcdef",
    ]);
    const [, margin] = uses;
    expect(css.slice(margin?.start, margin?.end)).toBe("13px");
  });

  it("reports plain elements where the library has a component, outside the library", () => {
    const values = valuesOf({
      "src/components/ui/button.tsx": "export const Button = () => <button />;",
      "src/form.tsx": `export const Form = () => (
  <form>
    <button type="submit">Save</button>
    <input type="checkbox" />
    <input type="text" />
    <Button>Ok</Button>
  </form>
);`,
    });
    expect(values).toEqual([
      "element raw button → Button ×1",
      "element raw input:checkbox → Checkbox ×1",
    ]);
  });

  it("skips types, imports and the files that are not the application's", () => {
    expect(usage.includes("src/app.tsx")).toBe(true);
    expect(usage.includes("src/styles.css")).toBe(true);
    expect(usage.includes("src/app.test.tsx")).toBe(false);
    expect(usage.includes("src/button.stories.tsx")).toBe(false);
    expect(usage.includes("vite.config.ts")).toBe(false);
    expect(usage.includes("node_modules/x/index.js")).toBe(false);
    expect(usage.includes("dist/app.js")).toBe(false);
    expect(usage.includes("src/types.d.ts")).toBe(false);
    const values = valuesOf({
      "src/app.tsx": `import "bg-red-500";
type Tone = "bg-red-500" | "p-4";
interface Props { tone: "text-gray-500" }
export const x = 1;`,
    });
    expect(values).toEqual([]);
  });

  it("counts only the theme's own tokens as the system before a design system is saved", () => {
    const inventory = inventoryOf(
      { "src/app.tsx": `const a = "bg-primary bg-blue-500 text-sm";` },
      { ...saved, ownTokens: ["color-primary", "color-background"] }
    );
    expect(inventory.against).toBe("theme");
    expect(inventory.ownColors).toBe(2);
    expect(
      inventory.values.map((v) => `${v.status} ${v.value}`).sort()
    ).toEqual([
      "default color-blue-500",
      "default text-sm",
      "system color-primary",
    ]);
  });

  it("recommends proposing a design system when the theme has few colours or the code is off it", () => {
    const thin = inventoryOf(
      { "src/app.tsx": `const a = "bg-primary";` },
      { ...saved, ownTokens: ["color-primary"] }
    );
    expect(thin.recommendation.mode).toBe("propose");
    const richer: UsageContext = {
      ...saved,
      designSystem: {
        ...designSystem,
        colors: [
          {
            name: "Semantic",
            tokens: ["primary", "background", "muted"].map((n) => ({
              name: `color-${n}`,
              value: "#000000",
            })),
          },
        ],
      },
    };
    const on = inventoryOf(
      { "src/app.tsx": `const a = "bg-[#101010] bg-primary bg-muted";` },
      richer
    );
    expect(on.recommendation.mode).toBe("adopt");
    const offMore = inventoryOf(
      {
        "src/app.tsx": `const a = "bg-[#101010] text-[#202020] border-[#303030] bg-primary";`,
      },
      richer
    );
    expect(offMore.recommendation).toEqual({
      mode: "propose",
      reason: "75% of the colours the code uses are not the theme's.",
    });
    const totals = offMore.totals.find((t) => t.kind === "color");
    expect(totals).toEqual({ default: 0, kind: "color", raw: 3, system: 1 });
  });
});
