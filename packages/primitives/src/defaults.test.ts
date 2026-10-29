import { ComponentSpec } from "@ultrapaint/contracts/specs";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PRIMITIVES } from "./catalogue.ts";
import { defaultSpecOf, PRIMITIVE_DEFAULTS } from "./defaults.ts";
import { PRIMITIVES_CSS } from "./look.ts";

describe("the default look", () => {
  it("is a valid design spec for every primitive, styling only its parts and axes", () => {
    expect(PRIMITIVE_DEFAULTS.map((s) => s.component)).toEqual(
      PRIMITIVES.map((p) => p.name)
    );
    for (const meta of PRIMITIVES) {
      const spec = defaultSpecOf(meta.name);
      expect(Schema.decodeUnknownSync(ComponentSpec)(spec)).toEqual(spec);
      expect(spec?.look).toBe("design");
      const parts = new Set(meta.slots.map((s) => s.name));
      const styled = [
        ...Object.keys(spec?.base ?? {}),
        ...Object.values(spec?.variants ?? {}).flatMap((members) =>
          Object.values(members).flatMap((styles) => Object.keys(styles))
        ),
      ];
      expect(styled.filter((slot) => !parts.has(slot))).toEqual([]);
      for (const [axis, members] of Object.entries(spec?.variants ?? {})) {
        expect(meta.variants[axis]).toEqual(
          expect.arrayContaining(Object.keys(members))
        );
      }
    }
  });

  it("is drawn in the primitives' layer, a portalled part found through its portal", () => {
    expect(PRIMITIVES_CSS).toContain(
      '[data-ed-p="Dialog"] [data-slot="dialog"]'
    );
    expect(PRIMITIVES_CSS).toContain("background-color: var(--color-primary)");
  });
});
