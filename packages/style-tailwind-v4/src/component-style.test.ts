import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { describe, expect, it } from "vitest";
import { componentStyle } from "./component-style.ts";

const token = (name: string, value: string): SourceToken => ({
  kind: "other",
  name,
  own: true,
  value,
});

const tokens = [
  token("color-primary", "#1a1c1e"),
  token("color-primary-foreground", "#ffffff"),
  token("radius-md", "8px"),
  token("spacing", "0.25rem"),
];

describe("componentStyle", () => {
  it("reads a shadcn button's classes as tokens and lengths", () => {
    expect(
      componentStyle(
        "inline-flex items-center rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2",
        tokens
      )
    ).toEqual({
      backgroundColor: "$color-primary",
      height: "2.25rem",
      padding: "1rem",
      rounded: "$radius-md",
      textColor: "$color-primary-foreground",
    });
  });

  it("takes arbitrary values the format can hold, and leaves out the rest", () => {
    expect(
      componentStyle(
        "bg-[#f7f5f2] text-sm rounded-[6px] h-[calc(100%-2px)] size-8 bg-primary/90 dark:text-primary",
        tokens
      )
    ).toEqual({ backgroundColor: "#f7f5f2", rounded: "6px", size: "2rem" });
  });

  it("lets a later class win, as the class list does", () => {
    expect(
      componentStyle("bg-primary bg-[#fff] rounded-md rounded-none", tokens)
    ).toEqual({ backgroundColor: "#fff", rounded: "0px" });
  });
});
