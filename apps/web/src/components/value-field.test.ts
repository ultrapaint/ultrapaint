import { describe, expect, it } from "vitest";
import { hintsOf, matches } from "./style-combobox.tsx";
import { isOutsideDesignSystem, withClear } from "./value-field.tsx";

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

describe("a field's Clear option", () => {
  const options = [{ description: "spacing-4", label: "16", value: "16" }];

  it("is offered last while the field holds a value, and not when it is empty", () => {
    expect(withClear(options, "16").map((o) => o.label)).toEqual([
      "16",
      "Clear",
    ]);
    expect(withClear(options, "").map((o) => o.label)).toEqual(["16"]);
  });

  it("shows nothing after its label, and is found by its label, never by its internal value", () => {
    const clear = withClear(options, "16").at(-1);
    expect(clear && hintsOf(clear)).toEqual([]);
    expect(clear && matches(clear, "clear")).toBe(true);
    expect(clear && matches(clear, "unset")).toBe(false);
  });

  it("leaves the other options' hints as they were: the description, then a value that says more", () => {
    expect(
      hintsOf({ description: "spacing-4", label: "16", value: "16" })
    ).toEqual(["spacing-4", "16"]);
    expect(
      hintsOf({ description: "fill", label: "Fill", value: "fill" })
    ).toEqual(["fill"]);
    expect(hintsOf({ label: "primary", value: "$color-primary" })).toEqual([
      "$color-primary",
    ]);
  });
});
