import { describe, expect, it } from "vitest";
import { emptyGroups, type TokenGroups } from "./format.ts";
import { flatten, mergeMirror, unflatten } from "./merge.ts";
import { parse } from "./parse.ts";

const doc = (front: string) => parse(`---\n${front}\n---\n## Colors\n`);

const code = (colors: Record<string, string>): TokenGroups => ({
  ...emptyGroups(),
  colors,
});

describe("flatten", () => {
  it("names every value by its path, and comes back as it was", () => {
    const groups: TokenGroups = {
      colors: { primary: "#000" },
      rounded: { md: "8px" },
      spacing: { base: "4px", columns: 12 },
      typography: { body: { fontSize: "16px", lineHeight: 1.5 } },
    };
    expect(flatten(groups)).toEqual({
      "colors.primary": "#000",
      "rounded.md": "8px",
      "spacing.base": "4px",
      "spacing.columns": 12,
      "typography.body.fontSize": "16px",
      "typography.body.lineHeight": 1.5,
    });
    expect(unflatten(flatten(groups))).toEqual(groups);
  });
});

describe("mergeMirror", () => {
  it("fills a document that has no tokens yet with the code's", () => {
    const merged = mergeMirror(
      parse("## Overview\n"),
      code({ primary: "#111" }),
      null
    );
    expect(merged.groups.colors).toEqual({ primary: "#111" });
    expect(merged.held).toEqual([]);
    expect(merged.agreed).toEqual({ "colors.primary": "#111" });
  });

  it("holds a document from elsewhere whole until it is matched", () => {
    const merged = mergeMirror(
      doc("colors:\n  tertiary: '#b8422e'"),
      code({ primary: "#111" }),
      null
    );
    expect(merged.groups.colors).toEqual({ tertiary: "#b8422e" });
    expect(merged.held.map((h) => h.path)).toEqual([
      "colors.tertiary",
      "colors.primary",
    ]);
  });

  it("takes what the code changed alone, and holds what the document changed", () => {
    const merged = mergeMirror(
      doc("colors:\n  a: '#000'\n  b: '#222'\n  c: '#333'\n  gone: '#444'"),
      code({ a: "#0a0", b: "#111", c: "#999", fresh: "#555" }),
      {
        "colors.a": "#000",
        "colors.b": "#111",
        "colors.c": "#300",
        "colors.gone": "#444",
      }
    );
    expect(merged.groups.colors).toEqual({
      a: "#0a0",
      b: "#222",
      c: "#333",
      fresh: "#555",
    });
    expect(merged.held).toEqual([
      { code: "#111", doc: "#222", kind: "doc", path: "colors.b" },
      { code: "#999", doc: "#333", kind: "both", path: "colors.c" },
    ]);
    expect(merged.agreed).toEqual({
      "colors.a": "#0a0",
      "colors.b": "#111",
      "colors.c": "#300",
      "colors.fresh": "#555",
    });
  });

  it("keeps a reference that comes to the code's value", () => {
    const merged = mergeMirror(
      doc("colors:\n  blue: '#25e'\n  primary: '{colors.blue}'"),
      code({ blue: "#25e", primary: "#25e" }),
      {}
    );
    expect(merged.groups.colors).toEqual({
      blue: "#25e",
      primary: "{colors.blue}",
    });
    expect(merged.held).toEqual([]);
  });

  it("holds a token the document took out, until Sync settles it", () => {
    const merged = mergeMirror(
      doc("colors:\n  a: '#000'"),
      code({ a: "#000", b: "#111" }),
      { "colors.a": "#000", "colors.b": "#111" }
    );
    expect(merged.groups.colors).toEqual({ a: "#000" });
    expect(merged.held).toEqual([
      { code: "#111", kind: "doc", path: "colors.b" },
    ]);
  });
});
