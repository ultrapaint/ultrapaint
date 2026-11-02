import { SystemComponentFile } from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { emptySystemComponent } from "@ultrapaint/contracts/testing/components";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "./catalogue.ts";
import { defaultLookOf, SYSTEM_DEFAULTS } from "./defaults.ts";
import { designCss, SYSTEM_COMPONENTS_CSS } from "./look.ts";

describe("the default look", () => {
  it("is a valid system component's file for each, styling only its parts and axes", () => {
    expect(SYSTEM_DEFAULTS.map((s) => s.name)).toEqual(
      SYSTEM_COMPONENTS.map((p) => p.name)
    );
    for (const meta of SYSTEM_COMPONENTS) {
      const spec = defaultLookOf(meta.name);
      expect(Schema.decodeUnknownSync(SystemComponentFile)(spec)).toEqual(spec);
      const parts = new Set(meta.slots.map((s) => s.name));
      const styled = [
        ...Object.keys(spec?.base ?? {}),
        ...Object.values(spec?.variants ?? {}).flatMap((members) =>
          Object.values(members).flatMap((styles) => Object.keys(styles))
        ),
      ];
      expect(styled.filter((slot) => !parts.has(slot))).toEqual([]);
      // A state is one the catalogue says the component has.
      expect(
        Object.keys(spec?.states ?? {}).filter(
          (st) => !meta.states.includes(st)
        )
      ).toEqual([]);
      for (const [axis, members] of Object.entries(spec?.variants ?? {})) {
        expect(meta.variants[axis]).toEqual(
          expect.arrayContaining(Object.keys(members))
        );
      }
      // A state in a member: of an axis and member it has, a state it has, a part it has.
      for (const [axis, members] of Object.entries(spec?.variantStates ?? {})) {
        expect(meta.variants[axis]).toEqual(
          expect.arrayContaining(Object.keys(members))
        );
        for (const states of Object.values(members)) {
          expect(meta.states).toEqual(
            expect.arrayContaining(Object.keys(states))
          );
          const slots = Object.values(states).flatMap((s) => Object.keys(s));
          expect(slots.filter((slot) => !parts.has(slot))).toEqual([]);
        }
      }
    }
  });

  it("reads back as it is written, and a file from before states in a member still reads", () => {
    const button = defaultLookOf("Button") ?? emptySystemComponent("Button");
    expect(button.variantStates?.variant?.outline?.hover?.root).toEqual({
      color: "$color-accent-foreground",
      fill: "$color-accent",
    });
    const json = JSON.parse(
      JSON.stringify(Schema.encodeSync(SystemComponentFile)(button))
    );
    expect(Schema.decodeUnknownSync(SystemComponentFile)(json)).toEqual(button);
    const { variantStates: _, ...older } = json;
    expect(
      Schema.decodeUnknownSync(SystemComponentFile)(older).variantStates
    ).toBeUndefined();
    expect(() =>
      Schema.decodeUnknownSync(SystemComponentFile)({
        ...older,
        variantStates: {
          variant: { outline: { hover: { root: { fill: 1 } } } },
        },
      })
    ).toThrow();
  });

  it("draws each button variant's hover of its own, after the general states, disabled after it", () => {
    const outlineHover = SYSTEM_COMPONENTS_CSS.indexOf(
      '[data-ed-c="Button"]:where([data-ed-v~="variant:outline"])'
    );
    const disabled = SYSTEM_COMPONENTS_CSS.indexOf(
      '[data-ed-c="Button"]:disabled'
    );
    expect(outlineHover).toBeGreaterThan(-1);
    expect(disabled).toBeGreaterThan(outlineHover);
    expect(SYSTEM_COMPONENTS_CSS).toContain(
      "background-color: color-mix(in oklab, var(--color-primary) 88%, var(--color-background))"
    );
    expect(SYSTEM_COMPONENTS_CSS).not.toContain('[data-variant="outline"]');
  });

  it("is drawn in the system components' layer, a portalled part found through its portal", () => {
    expect(SYSTEM_COMPONENTS_CSS).toContain(
      '[data-ed-p="Dialog"] [data-slot="dialog"]'
    );
    expect(SYSTEM_COMPONENTS_CSS).toContain(
      "background-color: var(--color-primary)"
    );
  });

  it("styles a part's own state where Base UI puts it, on the part", () => {
    expect(SYSTEM_COMPONENTS_CSS).toContain(
      '[data-ed-c="Checkbox"] [data-slot="checkbox"][data-checked]'
    );
    expect(SYSTEM_COMPONENTS_CSS).toContain(
      '[data-ed-p="Menu"] [data-slot="menu-item"][data-highlighted]'
    );
  });
});

describe("the design's stylesheet", () => {
  it("is the tokens' values, then the looks the project owns, and nothing for a design with neither", () => {
    expect(designCss([], null)).toBe("");
    const ds = {
      colors: [
        {
          name: "Brand",
          tokens: [{ name: "color-primary", value: "#123456" }],
        },
      ],
      radius: [],
      shadows: [],
      spacing: { base: "0.25rem" },
      typography: { fonts: [], sizes: [], styles: [], weights: [] },
      version: 1,
    } as unknown as DesignSystem;
    const css = designCss(
      [
        {
          ...emptySystemComponent("Card"),
          base: { root: { fill: "#ff0000" } },
        },
      ],
      ds
    );
    expect(css).toContain("--color-primary: #123456");
    expect(css).toContain('[data-ed-c="Card"]');
    expect(css.indexOf("--color-primary")).toBeLessThan(
      css.indexOf('[data-ed-c="Card"]')
    );
  });
});
