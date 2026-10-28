import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  arbitraryOf,
  COLOR_KEYWORDS,
  parseClass,
  printArbitrary,
  printClass,
  RADIUS_STEPS,
  SCREEN_KEYWORDS,
  SHADOW_STEPS,
  SIZE_KEYWORDS,
  splitModifier,
  TEXT_STEPS,
  utilityReader,
  WEIGHT_STEPS,
  weightStepOf,
} from "./utilities.ts";

const THEME_VAR_RE = /^\s*--([\w-]+):\s*([^;]+);/gm;

/** The variables of Tailwind's own default theme, deprecated ones left out. */
const defaultTheme = () => {
  const [css = ""] = readFileSync(
    createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
    "utf8"
  ).split("/* Deprecated */");
  return new Map(
    Array.from(css.matchAll(THEME_VAR_RE), (m) => [
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ])
  );
};

/** The steps of a scale the theme declares, `--radius-md` a step `md` of `radius`. */
const stepsOf = (theme: ReadonlyMap<string, string>, scale: string) =>
  [...theme.keys()].flatMap((name) => {
    const step = name.slice(scale.length + 1);
    return name.startsWith(`${scale}-`) && !step.includes("-") ? [step] : [];
  });

describe("a class's grammar", () => {
  it("takes a class apart into its variants, importance, sign and utility", () => {
    expect(parseClass("md:hover:!-mt-[13px]")).toEqual({
      important: "before",
      negative: true,
      utility: "mt-[13px]",
      variants: ["md", "hover"],
    });
    expect(parseClass("data-[state=open]:bg-primary/90!")).toEqual({
      important: "after",
      negative: false,
      utility: "bg-primary/90",
      variants: ["data-[state=open]"],
    });
    // A colon inside brackets or parentheses is the value's.
    expect(parseClass("[&_svg:not(.x)]:bg-[color:var(--edge)]")).toEqual({
      important: "",
      negative: false,
      utility: "bg-[color:var(--edge)]",
      variants: ["[&_svg:not(.x)]"],
    });
  });

  it("puts a class back together as it was", () => {
    for (const cls of [
      "md:hover:!-mt-[13px]",
      "max-md:flex-col",
      "md:max-lg:hidden",
      "bg-primary/90!",
      "-order-1",
      "text-(length:--text-x)",
    ]) {
      expect(printClass(parseClass(cls))).toBe(cls);
    }
  });

  it("reads a utility as the longest name it knows, and a bare one with no value", () => {
    const read = utilityReader(["gap", "gap-x", "rounded", "rounded-t", "p"]);
    expect(read("gap-x-2")).toEqual({ use: "gap-x", value: "2" });
    expect(read("gap-4")).toEqual({ use: "gap", value: "4" });
    expect(read("rounded-t-md")).toEqual({ use: "rounded-t", value: "md" });
    expect(read("rounded")).toEqual({ use: "rounded", value: undefined });
    expect(read("px-4")).toBeNull();
    expect(read("flex")).toBeNull();
  });

  it("takes a colour's opacity off its value, a slash in brackets kept", () => {
    expect(splitModifier("blue-500/50")).toEqual({
      modifier: "/50",
      value: "blue-500",
    });
    expect(splitModifier("[rgb(0_0_0/0.5)]")).toEqual({
      modifier: "",
      value: "[rgb(0_0_0/0.5)]",
    });
    expect(splitModifier("primary/[.3]")).toEqual({
      modifier: "/[.3]",
      value: "primary",
    });
  });

  it("reads an arbitrary value as CSS with its type, and writes it back", () => {
    const cases: readonly (readonly [string, string, string?])[] = [
      ["[#f7f5f2]", "#f7f5f2"],
      ["[calc(100%_-_2px)]", "calc(100% - 2px)"],
      ["[length:1.5rem]", "1.5rem", "length"],
      ["[color:var(--edge)]", "var(--edge)", "color"],
      ["[0_1px_2px_rgb(0_0_0/0.1)]", "0 1px 2px rgb(0 0 0/0.1)"],
    ];
    for (const [value, css, hint] of cases) {
      expect(arbitraryOf(value)).toEqual(
        hint === undefined ? { css } : { css, hint }
      );
      expect(printArbitrary(css, hint)).toBe(value);
    }
    // A URL keeps its underscores; a variable is `var()`, with its type too.
    expect(arbitraryOf("[url(/a_b.png)]")).toEqual({ css: "url(/a_b.png)" });
    expect(arbitraryOf("(--gutter)")).toEqual({ css: "var(--gutter)" });
    expect(arbitraryOf("(length:--x)")).toEqual({
      css: "var(--x)",
      hint: "length",
    });
    expect(arbitraryOf("4")).toBeUndefined();
    expect(arbitraryOf("primary")).toBeUndefined();
  });
});

describe("Tailwind's default scales", () => {
  const theme = defaultTheme();

  it("are the steps Tailwind's own theme declares", () => {
    expect([...TEXT_STEPS]).toEqual(stepsOf(theme, "text"));
    expect([...RADIUS_STEPS]).toEqual(stepsOf(theme, "radius"));
    expect([...SHADOW_STEPS]).toEqual(stepsOf(theme, "shadow"));
    expect([...WEIGHT_STEPS.keys()]).toEqual(stepsOf(theme, "font-weight"));
  });

  it("give each weight the number the theme does, and a number its step", () => {
    for (const [step, weight] of WEIGHT_STEPS) {
      expect(theme.get(`font-weight-${step}`)).toBe(String(weight));
      expect(weightStepOf(weight)).toBe(step);
    }
    expect(weightStepOf(550)).toBeUndefined();
  });
});

describe("keywords", () => {
  it("say a size both ways, the screen's on its own axis", () => {
    expect(SIZE_KEYWORDS.css("full")).toBe("100%");
    expect(SIZE_KEYWORDS.keyword("100%")).toBe("full");
    expect(SIZE_KEYWORDS.keyword("fit-content")).toBe("fit");
    expect(SIZE_KEYWORDS.css("screen")).toBeUndefined();
    expect(SCREEN_KEYWORDS.h.css("screen")).toBe("100vh");
    expect(SCREEN_KEYWORDS.w.keyword("100dvw")).toBe("dvw");
    expect(SCREEN_KEYWORDS.w.keyword("100vh")).toBeUndefined();
  });

  it("say a colour both ways: black and white as Tailwind's theme has them", () => {
    const theme = defaultTheme();
    expect(COLOR_KEYWORDS.css("black")).toBe(theme.get("color-black"));
    expect(COLOR_KEYWORDS.css("white")).toBe(theme.get("color-white"));
    expect(COLOR_KEYWORDS.css("current")).toBe("currentColor");
    for (const [css, keyword] of [
      ["black", "black"],
      ["#000", "black"],
      ["#FFF", "white"],
      ["currentcolor", "current"],
      ["transparent", "transparent"],
    ]) {
      expect(COLOR_KEYWORDS.keyword(css ?? "")).toBe(keyword);
    }
    // Only what Tailwind writes itself: another spelling of white is a value.
    expect(COLOR_KEYWORDS.keyword("#ffffff")).toBeUndefined();
  });
});
