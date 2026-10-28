import "../testing/fake-browser.ts";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import {
  addTokens,
  SPACING_STEPS,
  tokenPrefix,
} from "@ultrapaint/contracts/token-table";
import { describe, expect, it, vi } from "vitest";
import { FIELD_TOKEN_KINDS, tokenOptions } from "./token-options.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** A design system with one token of every kind a field picks from, `<prefix>x`. */
const ds = addTokens(
  { ...emptyDesignSystem(), spacing: { base: "0.5rem" } },
  FIELD_TOKEN_KINDS.map((kind) => ({
    name: `${tokenPrefix(kind)}x`,
    value: kind === "font" ? '"Inter", sans-serif' : "1px",
  }))
);

describe("the pickers' options", () => {
  it.each(FIELD_TOKEN_KINDS.map((kind) => [kind] as const))(
    "offer the %s tokens by their short names",
    (kind) => {
      const option = tokenOptions(ds, kind).find(
        (o) => o.value === `$${tokenPrefix(kind)}x`
      );
      expect(option?.label).toBe("x");
    }
  );

  it("offer spacing as the scale's named steps over the base in pixels, then the named spacings", () => {
    const options = tokenOptions(ds, "spacing");
    expect(options.slice(0, 3)).toEqual([
      { description: "spacing-0", label: "0", value: "0" },
      { description: "spacing-0.5", label: "4", value: "4" },
      { description: "spacing-1", label: "8", value: "8" },
    ]);
    expect(options).toHaveLength(SPACING_STEPS.length + 1);
    expect(tokenOptions(null, "spacing")[2]?.value).toBe("4");
  });

  it("say which group a colour is of and the family a font is", () => {
    expect(tokenOptions(ds, "color")[0]?.description).toBe("Colors");
    expect(tokenOptions(ds, "font")[0]?.description).toBe("Inter");
    expect(tokenOptions(null, "radius")).toEqual([]);
  });
});
