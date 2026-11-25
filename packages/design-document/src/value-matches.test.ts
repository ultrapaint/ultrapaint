import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { valueMatcher } from "./value-matches.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "Palette",
      tokens: [
        {
          name: "color-blue-600",
          value: "#2563eb",
          values: { dark: "#60a5fa" },
        },
        { name: "color-red-600", value: "#dc2626" },
      ],
    },
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "$color-blue-600" },
        { name: "color-accent", value: "#2563eb" },
      ],
    },
  ],
  radius: [{ name: "radius-lg", value: "0.5rem" }],
  spacing: {
    base: "0.25rem",
    tokens: [{ name: "spacing-gutter", value: "1.5rem" }],
  },
  themes: ["light", "dark"],
};

const page = (children: readonly DesignNode[], more: Partial<PageNode> = {}) =>
  ({ children, id: "root", type: "page", ...more }) as PageNode;

/** Each hit as node, field, value, and what it resolves to or the token's value it is near. */
const hits = (system: DesignSystem, match: string, root: DesignNode) =>
  valueMatcher(
    system,
    match
  )(root).map((m) => [
    m.node,
    m.field,
    m.value,
    ...(m.resolves === undefined ? [] : [m.resolves]),
    ...(m.near === undefined ? [] : [`near ${m.near}`]),
  ]);

describe("the nodes holding a value", () => {
  it("finds a raw colour, and a token that resolves to it with the token and its value", () => {
    const root = page([
      { children: [], fill: "#2563EB", id: "card", type: "group" },
      {
        color: "$color-accent",
        id: "t",
        role: "paragraph",
        text: "Hi",
        type: "text",
      },
      { children: [], fill: "#dc2626", id: "other", type: "group" },
    ]);
    expect(hits(ds, "#2563eb", root)).toEqual([
      ["card", "fill", "#2563EB"],
      ["t", "color", "$color-accent", "#2563eb"],
    ]);
  });

  it("finds a token by its name, a token it names, and a value written by hand equal to its value", () => {
    const root = page([
      { children: [], fill: "$color-primary", id: "a", type: "group" },
      { children: [], fill: "$color-blue-600", id: "b", type: "group" },
      {
        border: { color: "rgb(37 99 235)", width: 1 },
        children: [],
        id: "c",
        type: "group",
      },
      { children: [], fill: "$color-red-600", id: "d", type: "group" },
    ]);
    expect(hits(ds, "$color-primary", root)).toEqual([
      ["a", "fill", "$color-primary", "#2563eb"],
      ["b", "fill", "$color-blue-600", "#2563eb"],
      ["c", "border.color", "rgb(37 99 235)"],
    ]);
  });

  it("follows a token that names another to the value it draws", () => {
    const root = page([
      { children: [], fill: "$color-primary", id: "a", type: "group" },
    ]);
    expect(hits(ds, "#2563eb", root)).toEqual([
      ["a", "fill", "$color-primary", "#2563eb"],
    ]);
  });

  it("matches a spacing step by its pixels, the base times the step unless a named spacing holds it", () => {
    const root = page([
      { children: [], gap: "$spacing-4", id: "a", type: "row" },
      { children: [], gap: 16, id: "b", padding: { top: "1rem" }, type: "row" },
      {
        children: [],
        gap: "$spacing-gutter",
        id: "c",
        padding: 24,
        type: "row",
      },
    ]);
    expect(hits(ds, "$spacing-4", root)).toEqual([
      ["a", "gap", "$spacing-4", "16px"],
      ["b", "gap", 16],
      ["b", "padding.top", "1rem"],
    ]);
    expect(hits(ds, "16", root)).toEqual([
      ["a", "gap", "$spacing-4", "16px"],
      ["b", "gap", 16],
      ["b", "padding.top", "1rem"],
    ]);
    expect(hits(ds, "$spacing-6", root)).toEqual([
      ["c", "gap", "$spacing-gutter", "1.5rem"],
      ["c", "padding", 24],
    ]);
  });

  it("finds a value at every breakpoint and in every field a token stands for, by its path", () => {
    const root = page([
      {
        at: { md: { gap: 16, padding: { left: 16 } } },
        children: [],
        id: "a",
        margin: { bottom: 16 },
        radius: 16,
        type: "column",
      },
      {
        at: { lg: { tint: "#2563eb" } },
        id: "icon",
        src: "assets/i.svg",
        tint: "#2563eb",
        type: "image",
      },
      {
        at: { md: { size: 16 } },
        id: "t",
        role: "paragraph",
        size: 16,
        text: "Hi",
        type: "text",
      },
    ]);
    expect(hits(ds, "16", root)).toEqual([
      ["a", "radius", 16],
      ["a", "margin.bottom", 16],
      ["a", "at.md.gap", 16],
      ["a", "at.md.padding.left", 16],
      ["t", "size", 16],
      ["t", "at.md.size", 16],
    ]);
    expect(hits(ds, "#2563eb", root)).toEqual([
      ["icon", "tint", "#2563eb"],
      ["icon", "at.lg.tint", "#2563eb"],
    ]);
  });

  it("finds a colour among a fill's layers and a shadow among a shadow list", () => {
    const root = page([
      {
        children: [],
        fill: "linear-gradient(90deg, $color-primary, #fff)",
        id: "a",
        shadow: "0 1px 2px #000, 0 0 0 1px #2563eb",
        type: "group",
      },
    ]);
    expect(hits(ds, "$color-primary", root)).toEqual([
      ["a", "fill", "$color-primary", "#2563eb"],
    ]);
    expect(hits(ds, "0 0 0 1px #2563eb", root)).toEqual([
      ["a", "shadow", "0 0 0 1px #2563eb"],
    ]);
  });

  it("finds an instance's own fields and its overrides by layer, never its props, which are its component's", () => {
    const root = page([
      {
        component: "Card",
        fill: "#2563eb",
        from: "#app",
        id: "card",
        overrides: {
          "nav/label": { at: { md: { color: "#2563eb" } } },
          title: { color: "#2563eb", props: { tone: "#2563eb" } },
        },
        props: { accent: "#2563eb" },
        type: "instance",
      },
    ]);
    expect(hits(ds, "#2563eb", root)).toEqual([
      ["card", "fill", "#2563eb"],
      ["card", "overrides.nav/label.at.md.color", "#2563eb"],
      ["card", "overrides.title.color", "#2563eb"],
    ]);
  });

  it("marks a value written by hand near the token matched, with the token's value beside it", () => {
    const root = page([
      { children: [], fill: "#2a60e0", id: "close", type: "group" },
      { children: [], fill: "#16a34a", id: "far", type: "group" },
      { children: [], gap: 17, id: "row", type: "row" },
    ]);
    expect(hits(ds, "$color-primary", root)).toEqual([
      ["close", "fill", "#2a60e0", "near #2563eb"],
    ]);
    expect(hits(ds, "$spacing-4", root)).toEqual([
      ["row", "gap", 17, "near 16px"],
    ]);
    // A value matched is no token: nothing is near it.
    expect(hits(ds, "#2563eb", root)).toEqual([]);
  });

  it("finds a token with no value only by its name, never by another token with none", () => {
    const unvalued: DesignSystem = {
      ...emptyDesignSystem(),
      colors: [
        {
          name: "Semantic",
          tokens: [
            { name: "color-accent", value: "" },
            { name: "color-border", value: " " },
          ],
        },
      ],
    };
    const root = page([
      { children: [], fill: "$color-accent", id: "a", type: "group" },
      { children: [], fill: "$color-border", id: "b", type: "group" },
      { children: [], fill: "#fff", id: "c", type: "group" },
    ]);
    expect(hits(unvalued, "$color-accent", root)).toEqual([
      ["a", "fill", "$color-accent"],
    ]);
    expect(hits(unvalued, "", root)).toEqual([]);
  });

  it("answers no hits for a value nothing holds", () => {
    expect(hits(ds, "$radius-lg", page([]))).toEqual([]);
  });

  it("reads tokens in the default theme, and a design system without themes in its plain values", () => {
    const root = page([
      { children: [], fill: "#60a5fa", id: "dark", type: "group" },
      { children: [], fill: "$color-blue-600", id: "a", type: "group" },
    ]);
    expect(hits(ds, "#60a5fa", root)).toEqual([["dark", "fill", "#60a5fa"]]);
    const plain: DesignSystem = { ...ds, themes: undefined };
    expect(hits(plain, "#2563eb", root)).toEqual([
      ["a", "fill", "$color-blue-600", "#2563eb"],
    ]);
  });
});
