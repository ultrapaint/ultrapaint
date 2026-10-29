import type { SystemLook } from "@ultrapaint/contracts/components";
import { describe, expect, it } from "vitest";
import {
  BASE,
  fallbacksOf,
  inheritedAt,
  type Place,
  placeLabel,
  styleAt,
  withStyle,
} from "./look-places.ts";

const outline = { axis: "variant", member: "outline" };
const outlineHover: Place = { state: "hover", variant: outline };

const look: SystemLook = {
  base: { root: { fill: "$color-primary", padding: 8, radius: 4 } },
  states: { hover: { root: { fill: "$color-primary-hover" } } },
  variantStates: {
    variant: { outline: { hover: { root: { color: "$color-accent" } } } },
  },
  variants: {
    variant: {
      outline: { root: { border: { color: "$color-input" }, fill: "white" } },
    },
  },
};

describe("a look's places", () => {
  it("reads a part at the base, a member, a state and a state in a member", () => {
    expect(styleAt(look, BASE, "root").radius).toBe(4);
    expect(styleAt(look, { state: null, variant: outline }, "root").fill).toBe(
      "white"
    );
    expect(styleAt(look, { state: "hover", variant: null }, "root").fill).toBe(
      "$color-primary-hover"
    );
    expect(styleAt(look, outlineHover, "root")).toEqual({
      color: "$color-accent",
    });
    expect(styleAt(look, outlineHover, "label")).toEqual({});
    expect(placeLabel(outlineHover)).toBe("outline, hover");
    expect(placeLabel(BASE)).toBe("base");
  });

  it("writes a state in a member there alone, and takes out what is left empty", () => {
    const set = withStyle(look, outlineHover, "root", {
      color: "$color-accent",
      fill: "$color-accent",
    });
    expect(set.variantStates?.variant?.outline?.hover?.root?.fill).toBe(
      "$color-accent"
    );
    expect(set.states).toBe(look.states);
    expect(set.variants).toBe(look.variants);
    const cleared = withStyle(look, outlineHover, "root", {});
    expect(cleared.variantStates).toBeUndefined();
    const ghost = withStyle(
      look,
      { state: "open", variant: { axis: "variant", member: "ghost" } },
      "root",
      { fill: "$color-accent" }
    );
    expect(Object.keys(ghost.variantStates?.variant ?? {})).toEqual([
      "outline",
      "ghost",
    ]);
    expect(
      withStyle(look, { state: null, variant: outline }, "root", {}).variants
    ).toEqual({});
  });

  it("falls back from a state in a member to the state, the member and the base", () => {
    expect(fallbacksOf(outlineHover).map(placeLabel)).toEqual([
      "hover",
      "outline",
      "base",
    ]);
    expect(fallbacksOf({ state: "hover", variant: null })).toEqual([BASE]);
    expect(fallbacksOf(BASE)).toEqual([]);
  });

  it("says what each field takes and from where, the default look last", () => {
    const fallback: SystemLook = {
      base: { root: { shadow: "none" } },
      states: { hover: { root: { opacity: 0.9 } } },
      variants: {},
    };
    const inherited = inheritedAt(look, fallback, outlineHover, "root");
    expect(inherited.fill).toEqual({
      from: "hover",
      value: "$color-primary-hover",
    });
    expect(inherited["border.color"]).toEqual({
      from: "outline",
      value: "$color-input",
    });
    expect(inherited["padding.left"]).toEqual({ from: "base", value: 8 });
    expect(inherited.opacity).toEqual({ from: "default hover", value: 0.9 });
    expect(inherited.shadow).toEqual({ from: "default base", value: "none" });
    expect(inheritedAt(look, undefined, BASE, "root")).toEqual({});
  });
});
