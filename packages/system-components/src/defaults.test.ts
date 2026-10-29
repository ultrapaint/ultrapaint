import {
  emptySystemComponent,
  SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
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
    }
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
      '[data-ed-c="Checkbox"]:not([data-ed-wrapper]) [data-slot="checkbox"][data-checked]'
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
