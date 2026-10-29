import { SystemComponentFile } from "@ultrapaint/contracts/components";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "./catalogue.ts";
import { defaultLookOf, SYSTEM_DEFAULTS } from "./defaults.ts";
import { SYSTEM_COMPONENTS_CSS } from "./look.ts";

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
});
