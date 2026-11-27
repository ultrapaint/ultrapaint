import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { Declarations } from "@ultrapaint/contracts/node-style";
import { describe, expect, it } from "vitest";
import { tailwindClassReader } from "./class-reader.ts";
import { DEFAULT_THEME } from "./default-theme.ts";
import { tailwindClasses } from "./node-classes.ts";

const base = emptyDesignSystem();
const ds: DesignSystem = {
  ...base,
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#2b7fff" },
        { name: "background-color-subtle", value: "#f5f5f5" },
      ],
    },
  ],
  radius: [{ name: "radius-lg", value: "0.75rem" }],
  shadows: [{ name: "shadow-md", value: "0 4px 6px rgb(0 0 0 / 0.1)" }],
  typography: {
    ...base.typography,
    sizes: [{ lineHeight: "1.75rem", name: "text-lg", value: "1.125rem" }],
    weights: [{ name: "font-weight-bold", value: "700" }],
  },
};

const read = (classes: string, designSystem: DesignSystem | null = ds) =>
  tailwindClassReader(designSystem).read(classes.split(" "));

const sides = (property: string, value: string | number) => ({
  [`${property}Bottom`]: value,
  [`${property}Left`]: value,
  [`${property}Right`]: value,
  [`${property}Top`]: value,
});

describe("reading an element's classes", () => {
  it("reads a stack's classes into declarations, a class naming a token as that token", () => {
    expect(read("flex flex-col gap-4 bg-primary p-[13px] rounded-lg")).toEqual({
      declarations: {
        background: "$color-primary",
        borderRadius: "$radius-lg",
        display: "flex",
        flexDirection: "column",
        gap: "$spacing-4",
        ...sides("padding", 13),
      },
      unread: [],
      variants: [],
    });
  });

  it("reads an underline and its reset", () => {
    expect(read("underline").declarations).toEqual({
      textDecorationLine: "underline",
    });
    expect(read("no-underline").declarations).toEqual({
      textDecorationLine: "none",
    });
  });

  it("reads a utility's own namespace before every colour's", () => {
    expect(read("bg-subtle text-primary border-primary").declarations).toEqual({
      background: "$background-color-subtle",
      borderColor: "$color-primary",
      color: "$color-primary",
    });
  });

  it("reads a default of Tailwind's theme the design system does not declare as its value", () => {
    expect(
      read("bg-blue-500 rounded-md shadow-lg text-sm font-semibold")
        .declarations
    ).toEqual({
      background: DEFAULT_THEME.get("color-blue-500"),
      borderRadius: "0.375rem",
      boxShadow: DEFAULT_THEME.get("shadow-lg"),
      fontSize: "0.875rem",
      fontWeight: "600",
      lineHeight: "1.4286",
    });
  });

  it("reads a type size token with the line height it is paired with, and a weight token", () => {
    expect(read("text-lg font-bold").declarations).toEqual({
      fontSize: "$text-lg",
      fontWeight: "$font-weight-bold",
      lineHeight: "$text-lg--line-height",
    });
  });

  it("lets the narrower class win whatever their order: a side over every side, leading over a size", () => {
    expect(read("pt-2 px-[3px] p-4 leading-7 text-lg").declarations).toEqual({
      fontSize: "$text-lg",
      lineHeight: "$spacing-7",
      paddingBottom: "$spacing-4",
      paddingLeft: 3,
      paddingRight: 3,
      paddingTop: "$spacing-2",
    });
  });

  it("names a class with a variant and reads nothing from it", () => {
    expect(read("md:flex hover:bg-primary p-4")).toEqual({
      declarations: sides("padding", "$spacing-4"),
      unread: [],
      variants: ["md:flex", "hover:bg-primary"],
    });
  });

  it("names a class it does not know and reads nothing from it", () => {
    expect(
      read("transition grid-cols-3 border-t-2 bg-nowhere -p-2 [--tw-x:1] p-4")
    ).toEqual({
      declarations: sides("padding", "$spacing-4"),
      unread: [
        "transition",
        "grid-cols-3",
        "border-t-2",
        "bg-nowhere",
        "-p-2",
        "[--tw-x:1]",
      ],
      variants: [],
    });
  });

  it("reads an arbitrary property as the declaration it is", () => {
    expect(
      read("[position:absolute] [left:24px] [mask-size:100%_100%]").declarations
    ).toEqual({ left: 24, maskSize: "100% 100%", position: "absolute" });
  });

  it("reads a minus as a length below zero, a step in pixels of the design system's base", () => {
    const tight = { ...ds, spacing: { ...ds.spacing, base: "0.5rem" } };
    expect(read("-mt-2 -ml-[13px] -order-1", tight).declarations).toEqual({
      marginLeft: -13,
      marginTop: -16,
      order: "-1",
    });
  });

  it("mixes a colour's opacity into it, a fill keeping its token", () => {
    expect(read("bg-primary/50 text-black/[0.25]").declarations).toEqual({
      background: "color-mix(in oklab, $color-primary 50%, transparent)",
      color: "color-mix(in oklab, #000 25%, transparent)",
    });
  });

  it("reads a position and its offsets, in pixels where they are written so, a side over an axis", () => {
    expect(read("absolute left-[24px] top-6 inset-x-0").declarations).toEqual({
      left: 24,
      position: "absolute",
      right: 0,
      top: "$spacing-6",
    });
  });

  it("reads sizes by keyword, fraction and container", () => {
    expect(read("w-full h-1/2 max-w-md min-h-screen").declarations).toEqual({
      height: "50%",
      maxWidth: "28rem",
      minHeight: "100vh",
      width: "100%",
    });
  });

  it("reads a flex's alignment, wrap and growth", () => {
    expect(
      read("items-center justify-between flex-wrap flex-1 shrink-0")
        .declarations
    ).toEqual({
      alignItems: "center",
      flexBasis: "0%",
      flexGrow: "1",
      flexShrink: "0",
      flexWrap: "wrap",
      justifyContent: "space-between",
    });
  });

  it("reads arbitrary values as the CSS they hold, a variable of a declared token as the token", () => {
    expect(
      read(
        "text-[13px] text-[#333] border-2 border-[#f00] rounded-[6px] opacity-[.4] bg-(--color-primary) font-[Inter] shadow-none"
      ).declarations
    ).toEqual({
      background: "$color-primary",
      borderColor: "#f00",
      borderRadius: 6,
      borderStyle: "solid",
      borderWidth: 2,
      boxShadow: "none",
      color: "#333",
      fontFamily: "Inter",
      fontSize: 13,
      opacity: "0.4",
    });
  });

  it("leaves a minus on a token no length below zero names unread", () => {
    const named = {
      ...ds,
      spacing: {
        ...ds.spacing,
        tokens: [{ name: "spacing-gutter", value: "20px" }],
      },
    };
    expect(read("-mt-gutter mt-gutter", named)).toEqual({
      declarations: { marginTop: "$spacing-gutter" },
      unread: ["-mt-gutter"],
      variants: [],
    });
  });

  it("reads black and white as the design system's own tokens where it declares them", () => {
    const own = {
      ...ds,
      colors: [
        { name: "Base", tokens: [{ name: "color-white", value: "#fafafa" }] },
      ],
    };
    expect(read("bg-white text-black", own).declarations).toEqual({
      background: "$color-white",
      color: "#000",
    });
  });

  it("reads nothing from a value that names a property of every object", () => {
    expect(
      read("items-constructor flex-toString order-valueOf text-constructor")
        .unread
    ).toEqual([
      "items-constructor",
      "flex-toString",
      "order-valueOf",
      "text-constructor",
    ]);
  });

  it("names a type size token's line height only where the design system pairs it with one", () => {
    const plain = {
      ...ds,
      typography: {
        ...ds.typography,
        sizes: [{ name: "text-sm", value: "0.875rem" }],
      },
    };
    expect(read("text-sm", plain).declarations).toEqual({
      fontSize: "$text-sm",
    });
  });

  it("reads back what the class writer writes", () => {
    const declarations: Declarations = {
      alignItems: "center",
      background: "$color-primary",
      borderColor: "$color-primary",
      borderRadius: "$radius-lg",
      borderStyle: "dashed",
      borderWidth: 2,
      boxShadow: "$shadow-md",
      color: "#333",
      display: "flex",
      flexDirection: "column",
      fontSize: "$text-lg",
      fontWeight: "700",
      gap: "$spacing-4",
      justifyContent: "space-between",
      lineHeight: "$text-lg--line-height",
      opacity: "0.5",
      width: "100%",
      ...sides("padding", 13),
    };
    const classes = tailwindClasses(ds).classes([
      { breakpoint: null, declarations },
    ]);
    expect(tailwindClassReader(ds).read(classes)).toEqual({
      declarations: { ...declarations, fontWeight: "$font-weight-bold" },
      unread: [],
      variants: [],
    });
  });
});
