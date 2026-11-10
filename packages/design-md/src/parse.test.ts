import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "./parse.ts";
import { documentPathOf, documentTokens, groupsOf } from "./tokens.ts";

const upstream = (name: string) =>
  readFileSync(
    new URL(`../fixtures/upstream/${name}.md`, import.meta.url),
    "utf8"
  );

const UPSTREAM = ["atmospheric-glass", "paws-and-paths", "totality-festival"];

describe("parse", () => {
  it.each(UPSTREAM)("reads the upstream example %s", (name) => {
    const doc = parse(upstream(name));
    expect(doc.problems).toEqual([]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["front-matter"]);
    expect(doc.sections.map((s) => s.section)).toEqual([
      "Overview",
      "Colors",
      "Typography",
      "Layout",
      "Elevation & Depth",
      "Shapes",
      "Components",
    ]);
    expect(groupsOf(doc).problems).toEqual([]);
  });

  it("keeps a title, unknown sections, and headings inside fences out of the sections", () => {
    const doc = parse(
      [
        "# Heritage",
        "",
        "## Brand & Style",
        "Quiet.",
        "",
        "```md",
        "## Colors",
        "```",
        "## Iconography",
        "Lucide.",
        "",
      ].join("\n")
    );
    expect(doc.title).toBe("Heritage");
    expect(doc.sections.map((s) => [s.heading, s.section])).toEqual([
      ["Brand & Style", "Overview"],
      ["Iconography", null],
    ]);
    expect(doc.sections[0]?.text).toBe("Quiet.\n\n```md\n## Colors\n```\n");
  });

  it("reads tokens from yaml fences too, and refuses a group given twice", () => {
    const doc = parse(
      [
        "---",
        "name: Handout",
        "colors:",
        "  ink: '#1E1A14'",
        "---",
        "## Colors",
        "```yaml",
        "colors:",
        "  paper: '#F4F0E4'",
        "rounded:",
        "  sm: 2px",
        "```",
        "",
      ].join("\n")
    );
    expect(doc.blocks.map((b) => b.kind)).toEqual(["front-matter", "fence"]);
    expect(doc.keys.get("rounded")).toBe(1);
    expect(doc.values.colors).toEqual({ ink: "#1E1A14" });
    expect(doc.problems).toEqual([
      "`colors` is given in both the front matter and a yaml block.",
    ]);
  });

  it("says when a section is there twice, or the front matter never closes", () => {
    expect(parse("## Colors\n\n## Colours\n\n## Colors\n").problems).toEqual([
      "There are two Colors sections; the format allows one.",
    ]);
    expect(parse("---\nname: x\n## Colors\n").problems).toEqual([
      "The front matter opens with --- and is never closed.",
    ]);
  });
});

describe("documentTokens", () => {
  it("names the document's tokens as the code would, references followed", () => {
    const doc = parse(
      [
        "---",
        "colors:",
        "  blue-600: '#2563eb'",
        "  primary: '{colors.blue-600}'",
        "  broken: '{colors.nope}'",
        "rounded:",
        "  DEFAULT: 0.5rem",
        "spacing:",
        "  base: 4px",
        "  gutter: 24px",
        "  columns: 12",
        "---",
        "",
      ].join("\n")
    );
    const { problems, tokens } = documentTokens(doc);
    expect(tokens).toEqual([
      {
        kind: "color",
        name: "color-blue-600",
        value: "#2563eb",
        variable: "colors.blue-600",
      },
      {
        alias: "colors.blue-600",
        kind: "color",
        name: "color-primary",
        value: "#2563eb",
        variable: "colors.primary",
      },
      {
        kind: "radius",
        name: "radius-default",
        value: "0.5rem",
        variable: "rounded.DEFAULT",
      },
      {
        kind: "spacing",
        name: "spacing",
        value: "4px",
        variable: "spacing.base",
      },
      {
        kind: "spacing",
        name: "spacing-gutter",
        value: "24px",
        variable: "spacing.gutter",
      },
      {
        kind: "spacing",
        name: "spacing-columns",
        value: "12",
        variable: "spacing.columns",
      },
    ]);
    expect(problems).toEqual([
      "colors.broken refers to {colors.nope}, which is not a token.",
    ]);
  });

  it("types typography as the format does, a quoted weight a number", () => {
    const doc = parse(
      "---\ntypography:\n  body-md:\n    fontFamily: Public Sans\n    fontWeight: '400'\n    lineHeight: '1.6'\n    fontSize: 16\n---\n"
    );
    const { groups, problems } = groupsOf(doc);
    expect(groups.typography).toEqual({
      "body-md": {
        fontFamily: "Public Sans",
        fontWeight: 400,
        lineHeight: 1.6,
      },
    });
    expect(problems).toEqual([
      "typography.body-md.fontSize: 16 is not a length in px, em or rem.",
    ]);
  });

  it("says a weight or a line height that is no number, an empty one among them", () => {
    const doc = parse(
      "---\ntypography:\n  body:\n    fontWeight: ''\n    lineHeight: '0x10'\n---\n"
    );
    const { groups, problems } = groupsOf(doc);
    expect(groups.typography).toEqual({ body: {} });
    expect(problems).toEqual([
      "typography.body.fontWeight:  is not a number.",
      "typography.body.lineHeight: 0x10 is neither a number nor a length.",
    ]);
  });
});

describe("documentPathOf", () => {
  it("says where a code token goes in the front matter", () => {
    expect(documentPathOf("color-accent")).toBe("colors.accent");
    expect(documentPathOf("radius-lg")).toBe("rounded.lg");
    expect(documentPathOf("spacing")).toBe("spacing.base");
    expect(documentPathOf("spacing-gutter")).toBe("spacing.gutter");
    expect(documentPathOf("shadow-md")).toBeNull();
  });

  it("reads a detailed system's colour back from where it goes", () => {
    for (const name of [
      "text-color-subtle",
      "background-color-danger-subtle",
      "border-color-focus",
      "color-accent",
    ]) {
      const path = documentPathOf(name) ?? "";
      expect(path.startsWith("colors."), name).toBe(true);
      const doc = parse(
        ["---", "colors:", `  ${path.slice(7)}: '#2563eb'`, "---", ""].join(
          "\n"
        )
      );
      expect(documentTokens(doc).tokens).toEqual([
        { kind: "color", name, value: "#2563eb", variable: path },
      ]);
    }
  });
});
