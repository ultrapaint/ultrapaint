import { describe, expect, it } from "vitest";
import { shadowListCss, shadowsOf, tokensInShadow } from "./shadow.ts";

describe("a box's shadows", () => {
  it("reads a list as its shadows, the one drawn on top first", () => {
    expect(
      shadowsOf("$shadow-md, inset 0 1px 0 #fff, 0 8px 24px #0003")
    ).toEqual(["$shadow-md", "inset 0 1px 0 #fff", "0 8px 24px #0003"]);
  });

  it("splits no colour, its commas inside brackets", () => {
    expect(
      shadowsOf("0 1px 2px rgba(0,0,0,.1), inset 0 0 0 1px rgb(0 0 0 / 0.1)")
    ).toEqual(["0 1px 2px rgba(0,0,0,.1)", "inset 0 0 0 1px rgb(0 0 0 / 0.1)"]);
  });

  it("reads one shadow, a token or CSS, as one, and none as none", () => {
    expect(shadowsOf("$shadow-md")).toEqual(["$shadow-md"]);
    expect(shadowsOf("0 1px 2px rgba(0, 0, 0, 0.1)")).toEqual([
      "0 1px 2px rgba(0, 0, 0, 0.1)",
    ]);
    expect(shadowsOf(undefined)).toEqual([]);
    expect(shadowsOf("  ")).toEqual([]);
  });

  it("writes shadows back as the one list, none as no shadow", () => {
    const list = "$shadow-md, inset 0 0 0 1px rgba(0,0,0,.1)";
    expect(shadowListCss(shadowsOf(list))).toBe(list);
    expect(shadowListCss([])).toBeNull();
  });

  it("names the token of every shadow that is one, in order", () => {
    expect(
      tokensInShadow(
        "0 1px 2px #0002, $shadow-md, inset 0 1px 0 #fff, $shadow-lg"
      )
    ).toEqual(["shadow-md", "shadow-lg"]);
  });
});
