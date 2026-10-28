import { describe, expect, it } from "vitest";
import { isOutsideDesignSystem } from "./value-field.tsx";

describe("a field's value", () => {
  const options = [
    { label: "16", value: "16" },
    { label: "primary", value: "$color-primary" },
    { label: "Fill", value: "fill" },
  ];

  it("is outside the design system when it is neither a token nor one of the field's options", () => {
    expect(isOutsideDesignSystem("13", options)).toBe(true);
    expect(isOutsideDesignSystem("#ff0000", options)).toBe(true);
    expect(isOutsideDesignSystem("0 1px 2px black", options)).toBe(true);
  });

  it("is the design system's when it names a token, is an option, or is not set", () => {
    expect(isOutsideDesignSystem("$color-primary", options)).toBe(false);
    expect(isOutsideDesignSystem("$color-accent", options)).toBe(false);
    expect(isOutsideDesignSystem("16", options)).toBe(false);
    expect(isOutsideDesignSystem("16px", options)).toBe(false);
    expect(isOutsideDesignSystem("fill", options)).toBe(false);
    expect(isOutsideDesignSystem("", options)).toBe(false);
  });
});
