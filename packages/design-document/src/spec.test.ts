import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import { type ComponentSpec, emptySpec } from "@ultrapaint/contracts/specs";
import { describe, expect, it } from "vitest";
import { makeStyleContext } from "./css.ts";
import { specCss, specStyleCss, variantAttributeOf } from "./spec.ts";

const ds = {
  ...emptyDesignSystem(),
  colors: [
    { name: "Semantic", tokens: [{ name: "color-primary", value: "#123456" }] },
  ],
  shadows: [{ name: "shadow-sm", value: "0 1px 2px #0002" }],
};
const ctx = makeStyleContext(ds);

const ROOT =
  '[data-ed-c="Button"]:not([data-ed-wrapper]),\n[data-ed-c="Button"][data-ed-wrapper] > *';

const button = (spec: Partial<ComponentSpec>): ComponentSpec => ({
  ...emptySpec("Button", "@/components/ui/button"),
  ...spec,
});

/** The selector lists of a sheet, rule by rule. */
const selectorsOf = (css: string) =>
  css
    .split("\n\n")
    .map((rule) => rule.slice(0, rule.indexOf(" {")).split(",\n"));

describe("variantAttributeOf", () => {
  it("lists the scalar props by key, whitespace replaced", () => {
    expect(
      variantAttributeOf({
        children: "Save changes",
        disabled: true,
        onClick: () => undefined,
        size: "sm",
        style: { color: "red" },
        tabIndex: 0,
        variant: "outline wide",
      })
    ).toBe("disabled:true size:sm tabIndex:0 variant:outline_wide");
    expect(variantAttributeOf(undefined)).toBe("");
  });
});

describe("specStyleCss", () => {
  it("resolves tokens the way nodes do", () => {
    expect(
      specStyleCss(
        {
          border: { color: "$color-primary", width: 2 },
          fill: "$color-primary",
          fontWeight: 600,
          gap: "$spacing-2",
          height: 36,
          opacity: 0.5,
          padding: { left: "$spacing-4", top: 4 },
          radius: "50%",
          shadow: "$shadow-sm",
        },
        ctx
      )
    ).toEqual({
      "background-color": "var(--color-primary, #123456)",
      "border-color": "var(--color-primary, #123456)",
      "border-radius": "50%",
      "border-style": "solid",
      "border-width": "2px",
      "box-shadow": "var(--shadow-sm, 0 1px 2px #0002)",
      "font-weight": "600",
      gap: "calc(var(--spacing, 0.25rem) * 2)",
      height: "36px",
      opacity: "0.5",
      "padding-left": "calc(var(--spacing, 0.25rem) * 4)",
      "padding-top": "4px",
    });
  });

  it("recolours a border without drawing one, and works without a design system", () => {
    expect(
      specStyleCss(
        { border: { color: "$color-border" }, padding: 8 },
        makeStyleContext(null)
      )
    ).toEqual({ "border-color": "var(--color-border)", padding: "8px" });
  });
});

describe("specCss", () => {
  it("styles the root, bare or wrapped, and the slots inside it", () => {
    const css = specCss(
      [
        button({
          base: {
            icon: { width: 16 },
            root: { fill: "$color-primary" },
          },
          slots: [{ name: "root" }, { name: "icon" }],
        }),
      ],
      ctx
    );
    expect(css).toBe(
      `${ROOT} {\n  background-color: var(--color-primary, #123456);\n}\n\n` +
        '[data-ed-c="Button"]:not([data-ed-wrapper]) [data-slot="icon"],\n' +
        '[data-ed-c="Button"][data-ed-wrapper] > * [data-slot="icon"],\n' +
        '[data-ed-p="Button"] [data-slot="icon"],\n' +
        '[data-ed-p="Button"][data-slot="icon"] {\n  width: 16px;\n}\n'
    );
  });

  it("finds a part in a portal of the component's, a variant or a state on the portal", () => {
    const dialog: ComponentSpec = {
      ...emptySpec("Dialog", "@ultrapaint/system"),
      defaults: { size: "md" },
      slots: [{ name: "root" }, { name: "dialog" }],
      variants: { size: { lg: { dialog: { width: 640 } } } },
    };
    expect(selectorsOf(specCss([dialog], ctx))[0]).toEqual([
      '[data-ed-c="Dialog"]:not([data-ed-wrapper])[data-ed-v~="size:lg"] [data-slot="dialog"]',
      '[data-ed-c="Dialog"][data-ed-wrapper][data-ed-v~="size:lg"] > * [data-slot="dialog"]',
      '[data-ed-p="Dialog"][data-ed-v~="size:lg"] [data-slot="dialog"]',
      '[data-ed-p="Dialog"][data-ed-v~="size:lg"][data-slot="dialog"]',
    ]);
  });

  it("matches a member, and the default when the instance does not set its axis", () => {
    const css = specCss(
      [
        button({
          defaults: { size: "md" },
          variants: {
            size: {
              md: { root: { height: 36 } },
              sm: { root: { height: 32 } },
            },
          },
        }),
      ],
      ctx
    );
    expect(selectorsOf(css)).toEqual([
      [
        '[data-ed-c="Button"]:not([data-ed-wrapper])[data-ed-v~="size:md"]',
        '[data-ed-c="Button"][data-ed-wrapper][data-ed-v~="size:md"] > *',
        '[data-ed-c="Button"]:not([data-ed-wrapper]):not([data-ed-v^="size:"], [data-ed-v*=" size:"])',
        '[data-ed-c="Button"][data-ed-wrapper]:not([data-ed-v^="size:"], [data-ed-v*=" size:"]) > *',
      ],
      [
        '[data-ed-c="Button"]:not([data-ed-wrapper])[data-ed-v~="size:sm"]',
        '[data-ed-c="Button"][data-ed-wrapper][data-ed-v~="size:sm"] > *',
      ],
    ]);
  });

  it("writes the states after the variants, disabled last, pinned or live", () => {
    const css = specCss(
      [
        button({
          states: {
            disabled: { root: { opacity: 0.5 } },
            hover: { label: { color: "red" }, root: { fill: "blue" } },
          },
          variants: { variant: { ghost: { root: { fill: "none" } } } },
        }),
      ],
      ctx
    );
    const rules = selectorsOf(css);
    expect(rules.map((r) => r[0])).toEqual([
      '[data-ed-c="Button"]:not([data-ed-wrapper])[data-ed-v~="variant:ghost"]',
      '[data-ed-c="Button"]:not([data-ed-wrapper]):hover',
      '[data-ed-c="Button"]:not([data-ed-wrapper]):hover [data-slot="label"]',
      '[data-ed-c="Button"]:not([data-ed-wrapper]):disabled',
    ]);
    expect(rules[1]).toEqual([
      '[data-ed-c="Button"]:not([data-ed-wrapper]):hover',
      '[data-ed-c="Button"][data-ed-wrapper] > *:hover',
      '[data-ed-c="Button"]:not([data-ed-wrapper])[data-hovered]',
      '[data-ed-c="Button"][data-ed-wrapper] > *[data-hovered]',
      '[data-ed-c="Button"]:not([data-ed-wrapper])[data-ed-state~="hover"]',
      '[data-ed-c="Button"][data-ed-wrapper][data-ed-state~="hover"] > *',
    ]);
    expect(rules[3]).toContain(
      '[data-ed-c="Button"]:not([data-ed-wrapper])[aria-disabled="true"]'
    );
  });

  it("escapes names and values for attribute selectors", () => {
    const css = specCss(
      [
        {
          ...emptySpec('Odd"Name\\', "x"),
          base: { 'a"b': { opacity: 1 } },
        },
      ],
      ctx
    );
    expect(css).toContain(
      '[data-ed-c="Odd\\"Name\\\\"]:not([data-ed-wrapper]) [data-slot="a\\"b"]'
    );
  });

  it("draws nothing for a spec that mirrors the code, or sets nothing", () => {
    expect(
      specCss(
        [
          button({ base: { root: { fill: "red" } }, look: "code" }),
          button({ base: { root: {} } }),
        ],
        ctx
      )
    ).toBe("");
    expect(specCss([], ctx)).toBe("");
  });

  it("draws a draft over its instance as a component", () => {
    const draft = {
      ...emptySpec("Rating", "#draft"),
      base: { root: { gap: 4 } },
      draft: { children: [], id: "d", type: "row" as const },
    };
    expect(specCss([draft], ctx)).toContain(
      '[data-ed-c="Rating"]:not([data-ed-wrapper]),'
    );
  });
});
