import { SystemComponentFile } from "@ultrapaint/contracts/components";
import {
  DEFAULT_BLURS,
  type DesignSystem,
} from "@ultrapaint/contracts/design-system";
import { emptySystemComponent } from "@ultrapaint/contracts/testing/components";
import { contrastRatio } from "@ultrapaint/contracts/token-value";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "./catalogue.ts";
import { DEFAULT_LOOK, SYSTEM_ROLES } from "./default-look.ts";
import { defaultLookOf, SYSTEM_DEFAULTS } from "./defaults.ts";
import {
  designCss,
  NEUTRAL_COLORS,
  STATUS_COLORS,
  SYSTEM_COMPONENTS_CSS,
} from "./look.ts";

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

  it("names as roles every colour and radius the default looks read, with what each is for", () => {
    const read = new Set(
      JSON.stringify(SYSTEM_DEFAULTS).match(/\$(?:color|radius)-[a-z0-9-]+/g)
    );
    const roles = SYSTEM_ROLES.map((r) => r.name);
    expect(
      [...read].filter((token) => !roles.includes(token.slice(1)))
    ).toEqual([]);
    expect(roles).toEqual(
      expect.arrayContaining(["color-primary", "radius-md"])
    );
    expect(SYSTEM_ROLES.find((r) => r.name === "color-ring")?.description).toBe(
      "The focus ring"
    );
  });

  it("lists Tailwind's blurs, which the code's theme defines without declaring them", () => {
    expect(DEFAULT_LOOK.blurs).toEqual(DEFAULT_BLURS);
  });

  it("is drawn with the values the default look lists, a card's and a popup's shadow their level's", () => {
    const listed = [
      ...DEFAULT_LOOK.colors.flatMap((group) => group.tokens),
      ...DEFAULT_LOOK.typography.fonts,
      ...DEFAULT_LOOK.radius,
      ...DEFAULT_LOOK.shadows,
    ];
    for (const token of listed) {
      for (const value of [token.value, ...Object.values(token.values ?? {})]) {
        expect(SYSTEM_COMPONENTS_CSS).toContain(`--${token.name}: ${value};`);
      }
    }
    const shadowOf = (level: string) =>
      DEFAULT_LOOK.elevation?.find((l) => l.name === level)?.shadow;
    expect(defaultLookOf("Card")?.base.root?.shadow).toBe(shadowOf("Raised"));
    expect(
      [
        defaultLookOf("Menu")?.base["menu-popup"],
        defaultLookOf("Select")?.base["select-popup"],
        defaultLookOf("Popover")?.base.popover,
        defaultLookOf("Dialog")?.base.dialog,
        defaultLookOf("Toast")?.base.root,
      ].map((part) => part?.shadow)
    ).toEqual(new Array(5).fill(shadowOf("Overlay")));
    expect(SYSTEM_COMPONENTS_CSS).toContain("box-shadow: var(--shadow-lg)");
    expect(defaultLookOf("Switch")?.base["switch-thumb"]?.shadow).toBe(
      "$shadow-sm"
    );
  });

  it("edges what opens over the page with one line, a popup as a dialog and a toast", () => {
    expect(
      [
        defaultLookOf("Menu")?.base["menu-popup"],
        defaultLookOf("Select")?.base["select-popup"],
        defaultLookOf("Popover")?.base.popover,
        defaultLookOf("Dialog")?.base.dialog,
        defaultLookOf("Toast")?.base.root,
      ].map((part) => part?.border)
    ).toEqual(new Array(5).fill({ color: "$color-border", width: "1px" }));
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

describe("Badge's status members (UP-252)", () => {
  const STATUSES = ["warning", "success", "info"];
  /** The rule a look draws a Badge member with, from its selector to its closing brace. */
  const ruleOf = (css: string, member: string) => {
    const at = css.indexOf(
      `[data-ed-c="Badge"][data-ed-v~="variant:${member}"]`
    );
    return at === -1 ? "" : css.slice(at, css.indexOf("}", at));
  };

  it("draws each status filled with its role and set in its foreground, borderless", () => {
    for (const status of STATUSES) {
      const rule = ruleOf(SYSTEM_COMPONENTS_CSS, status);
      expect(rule).toContain(`background-color: var(--color-${status})`);
      expect(rule).toContain(`color: var(--color-${status}-foreground)`);
      expect(rule).not.toContain("border");
    }
  });

  it("gives each status role a default that reads in both themes, listed and described as the others", () => {
    expect(STATUS_COLORS.map((c) => c.name)).toEqual(
      STATUSES.flatMap((s) => [`color-${s}`, `color-${s}-foreground`])
    );
    for (const status of STATUSES) {
      const of = (name: string) => STATUS_COLORS.find((c) => c.name === name);
      for (const theme of ["light", "dark"] as const) {
        const fill = of(`color-${status}`)?.[theme] ?? "";
        const ink = of(`color-${status}-foreground`)?.[theme] ?? "";
        expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5);
      }
      expect(NEUTRAL_COLORS).toEqual(
        expect.arrayContaining([of(`color-${status}`)])
      );
      expect(
        SYSTEM_ROLES.find((r) => r.name === `color-${status}`)?.description
      ).toBeTruthy();
    }
  });

  it("draws a status a look written before it leaves unstyled in its role, and one it styles as the look says", () => {
    const taken = {
      ...(defaultLookOf("Badge") ?? emptySystemComponent("Badge")),
      base: { root: { fill: "$color-primary" } },
      variants: {
        variant: {
          info: { root: { fill: "#0000ff" } },
          secondary: { root: { fill: "$color-secondary" } },
        },
      },
    };
    const css = designCss([taken], null);
    expect(ruleOf(css, "warning")).toContain(
      "background-color: var(--color-warning)"
    );
    expect(ruleOf(css, "success")).toContain(
      "background-color: var(--color-success)"
    );
    expect(ruleOf(css, "info")).toContain("background-color: #0000ff");
    // A member it had before keeps its own say: one it leaves unstyled draws as its base.
    expect(ruleOf(css, "outline")).toBe("");
    expect(ruleOf(css, "destructive")).toBe("");
  });
});
