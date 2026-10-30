import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import { describe, expect, it } from "vitest";
import {
  type ComponentLook,
  lookCss,
  variantAttributeOf,
} from "./component-look.ts";
import { makeStyleContext } from "./css.ts";

/** A look that sets nothing. */
const emptyLook = (component: string): ComponentLook => ({
  base: {},
  component,
  defaults: {},
  parts: [],
  states: {},
  variants: {},
});

const ds = {
  ...emptyDesignSystem(),
  colors: [
    { name: "Semantic", tokens: [{ name: "color-primary", value: "#123456" }] },
  ],
  shadows: [{ name: "shadow-sm", value: "0 1px 2px #0002" }],
};
const ctx = makeStyleContext(ds);

const ROOT = '[data-ed-c="Button"]';
/** What a pointer's state adds: it shows only on a component that can be used. */
const USABLE = ":where(:not(:disabled, [data-disabled]))";

const button = (look: Partial<ComponentLook>): ComponentLook => ({
  ...emptyLook("Button"),
  ...look,
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

describe("lookCss", () => {
  /** The declarations of a look's one rule, the root's. */
  const rootCss = (
    root: ComponentLook["base"][string],
    context = ctx
  ): string => lookCss([button({ base: { root } })], context);

  it("resolves a part's tokens the way nodes do", () => {
    expect(
      rootCss({
        border: { color: "$color-primary", width: 2 },
        fill: "$color-primary",
        fontWeight: 600,
        gap: "$spacing-2",
        height: 36,
        opacity: 0.5,
        padding: { left: "$spacing-4", top: 4 },
        radius: "50%",
        shadow: "$shadow-sm",
      })
    ).toBe(
      `${ROOT} {
  background-color: var(--color-primary, #123456);
  border-color: var(--color-primary, #123456);
  border-width: 2px;
  border-style: solid;
  border-radius: 50%;
  padding-top: 4px;
  padding-left: calc(var(--spacing, 0.25rem) * 4);
  height: 36px;
  gap: calc(var(--spacing, 0.25rem) * 2);
  opacity: 0.5;
  box-shadow: var(--shadow-sm, 0 1px 2px #0002);
  font-weight: 600;
}
`
    );
  });

  it("recolours a border without drawing one, and works without a design system", () => {
    expect(
      rootCss(
        { border: { color: "$color-border" }, padding: 8 },
        makeStyleContext(null)
      )
    ).toBe(
      `${ROOT} {\n  border-color: var(--color-border);\n  padding: 8px;\n}\n`
    );
  });

  it("styles the root and the slots inside it", () => {
    const css = lookCss(
      [
        button({
          base: {
            icon: { width: 16 },
            root: { fill: "$color-primary" },
          },
          parts: ["root", "icon"],
        }),
      ],
      ctx
    );
    expect(css).toBe(
      `${ROOT} {\n  background-color: var(--color-primary, #123456);\n}\n\n` +
        '[data-ed-c="Button"] [data-slot="icon"],\n' +
        '[data-ed-p="Button"] [data-slot="icon"],\n' +
        '[data-ed-p="Button"][data-slot="icon"] {\n  width: 16px;\n}\n'
    );
  });

  it("finds a part in a portal of the component's, a variant or a state on the portal", () => {
    const dialog: ComponentLook = {
      ...emptyLook("Dialog"),
      defaults: { size: "md" },
      parts: ["root", "dialog"],
      variants: { size: { lg: { dialog: { width: 640 } } } },
    };
    expect(selectorsOf(lookCss([dialog], ctx))[0]).toEqual([
      '[data-ed-c="Dialog"][data-ed-v~="size:lg"] [data-slot="dialog"]',
      '[data-ed-p="Dialog"][data-ed-v~="size:lg"] [data-slot="dialog"]',
      '[data-ed-p="Dialog"][data-ed-v~="size:lg"][data-slot="dialog"]',
    ]);
  });

  it("matches a member, and the default when the instance does not set its axis", () => {
    const css = lookCss(
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
        '[data-ed-c="Button"][data-ed-v~="size:md"]',
        '[data-ed-c="Button"]:not([data-ed-v^="size:"], [data-ed-v*=" size:"])',
      ],
      ['[data-ed-c="Button"][data-ed-v~="size:sm"]'],
    ]);
  });

  it("writes the states after the variants, disabled last, pinned or live", () => {
    const css = lookCss(
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
      '[data-ed-c="Button"][data-ed-v~="variant:ghost"]',
      `[data-ed-c="Button"]${USABLE}:hover`,
      `[data-ed-c="Button"]${USABLE}:hover [data-slot="label"]`,
      '[data-ed-c="Button"]:disabled',
    ]);
    expect(rules[1]).toEqual([
      `[data-ed-c="Button"]${USABLE}:hover`,
      `[data-ed-c="Button"]${USABLE}[data-hovered]`,
      `[data-ed-c="Button"][data-ed-state~="hover"]${USABLE}`,
    ]);
    expect(rules[3]).toContain('[data-ed-c="Button"][aria-disabled="true"]');
  });

  it("writes a state in a member after the states, as specific, and disabled after them all", () => {
    const css = lookCss(
      [
        button({
          defaults: { variant: "primary" },
          states: {
            disabled: { root: { opacity: 0.5 } },
            hover: { root: { fill: "blue" } },
          },
          variantStates: {
            variant: {
              outline: {
                disabled: { root: { opacity: 0.4 } },
                hover: { root: { fill: "gray" } },
              },
              primary: { open: { root: { fill: "navy" } } },
            },
          },
          variants: { variant: { outline: { root: { fill: "white" } } } },
        }),
      ],
      ctx
    );
    const rules = selectorsOf(css);
    expect(rules.map((r) => r[0])).toEqual([
      '[data-ed-c="Button"][data-ed-v~="variant:outline"]',
      `[data-ed-c="Button"]${USABLE}:hover`,
      `[data-ed-c="Button"]:where([data-ed-v~="variant:outline"])${USABLE}:hover`,
      '[data-ed-c="Button"]:where([data-ed-v~="variant:primary"])[data-open]',
      '[data-ed-c="Button"]:disabled',
      '[data-ed-c="Button"]:where([data-ed-v~="variant:outline"]):disabled',
    ]);
    // The default member's state also matches an instance that does not set the axis, pinned too.
    expect(rules[3]).toContain(
      '[data-ed-c="Button"]:where(:not([data-ed-v^="variant:"], [data-ed-v*=" variant:"]))[data-ed-state~="open"]'
    );
    expect(rules[2]).toContain(
      `[data-ed-c="Button"]:where([data-ed-v~="variant:outline"])[data-ed-state~="hover"]${USABLE}`
    );
  });

  it("escapes names and values for attribute selectors", () => {
    const css = lookCss(
      [
        {
          ...emptyLook('Odd"Name\\'),
          base: { 'a"b': { opacity: 1 } },
        },
      ],
      ctx
    );
    expect(css).toContain('[data-ed-c="Odd\\"Name\\\\"] [data-slot="a\\"b"]');
  });

  it("draws nothing for a look that sets nothing", () => {
    expect(lookCss([button({ base: { root: {} } })], ctx)).toBe("");
    expect(lookCss([], ctx)).toBe("");
  });

  it("lays a part out, and leaves an optional part out", () => {
    const css = lookCss(
      [
        button({
          base: {
            label: { align: "between", crossAlign: "center", direction: "row" },
            root: { order: 2 },
          },
          hidden: ["icon"],
        }),
      ],
      ctx
    );
    expect(css).toContain(
      "display: flex;\n  flex-direction: row;\n  justify-content: space-between;\n  align-items: center;"
    );
    expect(css).toContain("order: 2;");
    expect(css).toContain(
      '[data-ed-c="Button"] [data-slot="icon"],\n[data-ed-p="Button"] [data-slot="icon"],\n[data-ed-p="Button"][data-slot="icon"] {\n  display: none;\n}'
    );
  });

  it("matches a part's state on the part as well as on the root", () => {
    const css = lookCss(
      [button({ states: { checked: { box: { fill: "red" } } } })],
      ctx
    );
    const [rule] = selectorsOf(css);
    expect(rule).toContain(
      '[data-ed-c="Button"] [data-slot="box"][data-checked]'
    );
    expect(rule).toContain(
      '[data-ed-c="Button"][data-checked] [data-slot="box"]'
    );
    expect(rule).toContain(
      '[data-ed-p="Button"] [data-slot="box"][data-checked]'
    );
  });
});
