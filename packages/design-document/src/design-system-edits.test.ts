import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  type Edited,
  editLabel,
  tokenChangesOf,
} from "./design-system-edits.ts";

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "primary",
      tokens: [
        { name: "color-primary-500", value: "#3b82f6" },
        {
          description: "Buttons",
          name: "color-primary-600",
          value: "#2563eb",
          values: { dark: "#60a5fa" },
        },
      ],
    },
    { name: "Semantic", tokens: [{ name: "color-ink", value: "#111111" }] },
  ],
  radius: [{ name: "radius-md", value: "0.5rem" }],
  themes: ["light", "dark"],
  typography: {
    fonts: [],
    sizes: [{ name: "text-sm", value: "0.875rem" }],
    styles: [{ name: "Body", role: "paragraph", size: "$text-sm" }],
    weights: [],
  },
};

const ok = (edited: Edited): DesignSystem => {
  if ("problem" in edited) {
    throw new Error(edited.problem);
  }
  return edited;
};

describe("applyEdits", () => {
  it("sets a value in the default theme and in another, and takes another's out", () => {
    const set = ok(
      applyEdits(ds, [
        { name: "color-primary-600", op: "setValue", value: "#1d4ed8" },
        {
          name: "color-primary-600",
          op: "setValue",
          theme: "dark",
          value: "#93c5fd",
        },
        {
          name: "color-primary-500",
          op: "setValue",
          theme: "light",
          value: " #2563eb ",
        },
      ])
    );
    expect(tokenOf(set, "color-primary-600")).toEqual({
      description: "Buttons",
      name: "color-primary-600",
      value: "#1d4ed8",
      values: { dark: "#93c5fd" },
    });
    // The default theme named is the plain value.
    expect(tokenOf(set, "color-primary-500")?.value).toBe("#2563eb");
    const out = ok(
      applyEdits(set, [
        {
          name: "color-primary-600",
          op: "setValue",
          theme: "dark",
          value: null,
        },
      ])
    );
    expect(tokenOf(out, "color-primary-600")?.values).toEqual({});
  });

  it("refuses a token it does not have, a theme it does not have, and an empty value", () => {
    expect(
      applyEdits(ds, [{ name: "color-nope", op: "setValue", value: "red" }])
    ).toEqual({
      problem: "setValue color-nope: the design system has no such token",
    });
    expect(
      applyEdits(ds, [
        { name: "color-ink", op: "setValue", theme: "dim", value: "red" },
      ])
    ).toEqual({
      problem: "setValue color-ink in dim: the design system has no theme dim",
    });
    expect(
      "problem" in
        applyEdits(ds, [{ name: "color-ink", op: "setValue", value: " " }])
    ).toBe(true);
    expect(
      "problem" in
        applyEdits(ds, [{ name: "color-ink", op: "setValue", value: null }])
    ).toBe(true);
  });

  it("applies nothing when one operation of the list does not fit", () => {
    const edited = applyEdits(ds, [
      { name: "color-ink", op: "setValue", value: "#000000" },
      { name: "color-nope", op: "removeToken" },
    ]);
    expect(edited).toEqual({
      problem: "removeToken color-nope: the design system has no such token",
    });
  });

  it("describes a token and takes the description out", () => {
    const described = ok(
      applyEdits(ds, [
        { description: "Body text", name: "color-ink", op: "setDescription" },
        { description: "", name: "color-primary-600", op: "setDescription" },
      ])
    );
    expect(tokenOf(described, "color-ink")?.description).toBe("Body text");
    expect(tokenOf(described, "color-primary-600")).not.toHaveProperty(
      "description"
    );
  });

  it("adds a token where its kind goes, a colour in the group named, with its themes", () => {
    const added = ok(
      applyEdits(ds, [
        {
          group: "primary",
          name: "color-primary-700",
          op: "addToken",
          value: "#1d4ed8",
          values: { dark: "#3b82f6", light: "#000000" },
        },
        { name: "color-line", op: "addToken", value: "#e5e5e5" },
        { name: "radius-xl", op: "addToken", value: "1rem" },
      ])
    );
    expect(added.colors[0]?.tokens.map((t) => t.name)).toEqual([
      "color-primary-500",
      "color-primary-600",
      "color-primary-700",
    ]);
    // The default theme's value is the plain one, never one of the others.
    expect(tokenOf(added, "color-primary-700")).toEqual({
      name: "color-primary-700",
      value: "#1d4ed8",
      values: { dark: "#3b82f6" },
    });
    expect(added.colors[1]?.tokens.map((t) => t.name)).toEqual([
      "color-ink",
      "color-line",
    ]);
    expect(added.radius.map((t) => t.name)).toEqual(["radius-md", "radius-xl"]);
  });

  it("refuses a duplicate, a name of no kind and a group it does not have", () => {
    expect(
      applyEdits(ds, [{ name: "radius-md", op: "addToken", value: "1px" }])
    ).toEqual({
      problem:
        "addToken radius-md: the design system has a token of that name already",
    });
    expect(
      "problem" in
        applyEdits(ds, [{ name: "banana", op: "addToken", value: "1px" }])
    ).toBe(true);
    expect(
      "problem" in
        applyEdits(ds, [
          { group: "nope", name: "color-x", op: "addToken", value: "red" },
        ])
    ).toBe(true);
    expect(
      "problem" in
        applyEdits(ds, [
          { group: "primary", name: "radius-x", op: "addToken", value: "1px" },
        ])
    ).toBe(true);
  });

  it("takes a token out, never the spacing base", () => {
    const removed = ok(
      applyEdits(ds, [{ name: "color-primary-500", op: "removeToken" }])
    );
    expect(tokenOf(removed, "color-primary-500")).toBeUndefined();
    expect(
      "problem" in applyEdits(ds, [{ name: "spacing", op: "removeToken" }])
    ).toBe(true);
  });

  it("moves a colour between groups, at a place or at the end", () => {
    const moved = ok(
      applyEdits(ds, [
        {
          group: "Semantic",
          index: 0,
          name: "color-primary-500",
          op: "moveToken",
        },
      ])
    );
    expect(moved.colors.map((g) => g.tokens.map((t) => t.name))).toEqual([
      ["color-primary-600"],
      ["color-primary-500", "color-ink"],
    ]);
    expect(
      "problem" in
        applyEdits(ds, [
          { group: "primary", name: "radius-md", op: "moveToken" },
        ])
    ).toBe(true);
  });

  it("adds a group and renames one with its tokens", () => {
    const grouped = ok(
      applyEdits(ds, [
        { name: "accent", op: "addGroup" },
        { name: "primary", op: "renameGroup", to: "brand" },
      ])
    );
    expect(grouped.colors.map((g) => [g.name, g.tokens.length])).toEqual([
      ["brand", 2],
      ["Semantic", 1],
      ["accent", 0],
    ]);
    expect(
      "problem" in applyEdits(ds, [{ name: "primary", op: "addGroup" }])
    ).toBe(true);
    expect(
      "problem" in
        applyEdits(ds, [{ name: "primary", op: "renameGroup", to: "Semantic" }])
    ).toBe(true);
  });

  it("sets a text style in its place or after the others, and takes one out", () => {
    const styled = ok(
      applyEdits(ds, [
        {
          op: "setTextStyle",
          style: {
            name: "Body",
            role: "paragraph",
            size: "$text-sm",
            weight: 500,
          },
        },
        { op: "setTextStyle", style: { name: "Title", role: "heading" } },
      ])
    );
    expect(styled.typography.styles).toEqual([
      { name: "Body", role: "paragraph", size: "$text-sm", weight: 500 },
      { name: "Title", role: "heading" },
    ]);
    const removed = ok(
      applyEdits(styled, [{ name: "Body", op: "removeTextStyle" }])
    );
    expect(removed.typography.styles.map((s) => s.name)).toEqual(["Title"]);
    expect(
      "problem" in applyEdits(ds, [{ name: "Nope", op: "removeTextStyle" }])
    ).toBe(true);
  });
});

describe("tokenChangesOf", () => {
  it("tells the code the values, the default theme's as the plain value", () => {
    expect(
      tokenChangesOf(ds, [
        { name: "color-ink", op: "setValue", theme: "light", value: "#000" },
        { name: "color-ink", op: "setValue", theme: "dark", value: null },
        {
          name: "radius-xl",
          op: "addToken",
          value: "1rem",
          values: { dark: "2rem" },
        },
        { name: "radius-md", op: "removeToken" },
        { name: "accent", op: "addGroup" },
      ])
    ).toEqual([
      { name: "color-ink", value: "#000" },
      { name: "color-ink", remove: true, theme: "dark" },
      { name: "radius-xl", value: "1rem" },
      { name: "radius-xl", theme: "dark", value: "2rem" },
      { name: "radius-md", remove: true },
    ]);
  });
});

describe("editLabel", () => {
  it("says what one operation does, and counts several", () => {
    expect(
      editLabel([
        { name: "color-ink", op: "setValue", theme: "dark", value: "#000" },
      ])
    ).toBe("Change color-ink in dark");
    expect(editLabel([{ name: "radius-md", op: "removeToken" }])).toBe(
      "Remove radius-md"
    );
    expect(
      editLabel([
        { name: "a", op: "setValue", value: "1" },
        { name: "b", op: "setValue", value: "2" },
      ])
    ).toBe("Change 2 tokens");
  });
});
