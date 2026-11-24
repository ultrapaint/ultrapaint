import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { hintsOf, itemsFor, matches } from "./style-combobox.tsx";
import {
  isOutsideDesignSystem,
  typedValue,
  withClear,
} from "./value-field.tsx";

// The field makes tokens through the editor's stores, which reach for the connection when made.
vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

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

describe("a field that knows its kind of token", () => {
  const spacing = [
    { description: "spacing-4", label: "16", value: "16" },
    { description: "spacing-5", label: "20", value: "20" },
  ];

  it("calls a whole or half step of the spacing scale on the system, as the design's checks do", () => {
    const field = { kind: "spacing", spacingBase: 4 } as const;
    expect(isOutsideDesignSystem("18", spacing, field)).toBe(false);
    expect(isOutsideDesignSystem("18px", spacing, field)).toBe(false);
    expect(isOutsideDesignSystem("17.5", spacing, field)).toBe(true);
    // Without its kind, the field knows only the values it offers.
    expect(isOutsideDesignSystem("18", spacing)).toBe(true);
  });

  it("calls a round radius on the system, as the design's checks do", () => {
    const radius = { kind: "radius", spacingBase: 4 } as const;
    expect(isOutsideDesignSystem("50%", [], radius)).toBe(false);
    expect(isOutsideDesignSystem("7", [], radius)).toBe(true);
  });

  it("calls a keyword that is no value on the system, as the design's checks do", () => {
    expect(
      isOutsideDesignSystem("none", [], { kind: "radius", spacingBase: 4 })
    ).toBe(false);
    expect(
      isOutsideDesignSystem("transparent", [], {
        kind: "color",
        spacingBase: 4,
      })
    ).toBe(false);
  });

  it("still calls a raw colour outside the design system", () => {
    expect(
      isOutsideDesignSystem("#2563eb", [], { kind: "color", spacingBase: 4 })
    ).toBe(true);
    expect(
      isOutsideDesignSystem("$color-primary", [], {
        kind: "color",
        spacingBase: 4,
      })
    ).toBe(false);
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

  it("is not brought up by typing its internal value, where the field takes any text", () => {
    const list = withClear(options, "16");
    const anyText = (q: string) => q;
    expect(itemsFor(list, "__unset", anyText)).toEqual([]);
    expect(itemsFor(list, "Inter", anyText).map((o) => o.value)).toEqual([
      "Inter",
    ]);
    expect(itemsFor(list, "16", anyText).map((o) => o.label)).toEqual(["16"]);
  });

  it("can't be typed as a value, even where the field is empty and takes any text", () => {
    const anyText = () => true;
    expect(typedValue("__unset", anyText)).toBeNull();
    expect(
      itemsFor(withClear(options, ""), "__unset", (q) => typedValue(q, anyText))
    ).toEqual([]);
    expect(typedValue("Inter", anyText)).toBe("Inter");
    expect(typedValue("Inter")).toBeNull();
    expect(typedValue("12px")).toBe("12px");
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
