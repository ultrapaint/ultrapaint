import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyGroups, type TokenGroups } from "./format.ts";
import { parse } from "./parse.ts";
import { groupsOf } from "./tokens.ts";
import {
  create,
  renameRefs,
  type WriteResult,
  withMirror,
  withSection,
} from "./write.ts";

const upstream = (name: string) =>
  readFileSync(
    new URL(`../fixtures/upstream/${name}.md`, import.meta.url),
    "utf8"
  );

const UPSTREAM = ["atmospheric-glass", "paws-and-paths", "totality-festival"];

const textOf = (result: WriteResult): string => {
  if ("problem" in result) {
    throw new Error(result.problem);
  }
  return result.text;
};

/** The lines of `after` that are not in `before`, and the other way round. */
const changedLines = (before: string, after: string) => {
  const a = before.split("\n");
  const b = after.split("\n");
  return {
    added: b.filter((line) => !a.includes(line)),
    removed: a.filter((line) => !b.includes(line)),
  };
};

describe("withMirror", () => {
  it.each(UPSTREAM)(
    "leaves %s byte for byte when the code agrees with it",
    (name) => {
      const text = upstream(name);
      const result = withMirror(text, groupsOf(parse(text)).groups);
      expect(result).toEqual({ changed: false, text });
    }
  );

  it("changes only the line of the token whose value changed", () => {
    const text = upstream("paws-and-paths");
    const { groups } = groupsOf(parse(text));
    const after = textOf(
      withMirror(text, {
        ...groups,
        colors: { ...groups.colors, primary: "#123456" },
      })
    );
    expect(changedLines(text, after)).toEqual({
      added: ['  primary: "#123456"'],
      removed: ['  primary: "#855300"'],
    });
  });

  it("adds a token at the end of its group and takes out one the code no longer has", () => {
    const text = upstream("totality-festival");
    const { groups } = groupsOf(parse(text));
    const [first, ...rest] = Object.keys(groups.rounded);
    const rounded = Object.fromEntries(
      rest.map((k) => [k, groups.rounded[k] ?? ""])
    );
    const after = parse(
      textOf(
        withMirror(text, { ...groups, rounded: { ...rounded, huge: "48px" } })
      )
    );
    const keys = Object.keys(after.values.rounded as object);
    expect(keys).not.toContain(first);
    expect(keys.at(-1)).toBe("huge");
    expect(after.sections).toHaveLength(parse(text).sections.length);
  });

  it("keeps a reference that comes to the code's value", () => {
    const text =
      "---\ncolors:\n  blue: '#2563eb'\n  primary: '{colors.blue}'\n---\n## Colors\n";
    const groups: TokenGroups = {
      ...emptyGroups(),
      colors: { blue: "#2563eb", primary: "#2563eb" },
    };
    expect(withMirror(text, groups)).toEqual({ changed: false, text });
  });

  it("keeps the authors' keys, comments and body as they are", () => {
    const text = [
      "---",
      "version: alpha",
      "name: Heritage # the brand's own name",
      "x-figma: abc123",
      "colors:",
      "  # The ink",
      "  primary: '#1A1C1E'",
      "---",
      "",
      "## Overview",
      "",
      "Architectural minimalism. Uses {colors.primary}.",
      "",
    ].join("\n");
    const groups: TokenGroups = {
      ...emptyGroups(),
      colors: { primary: "#1A1C1E" },
      rounded: { sm: "4px" },
    };
    const after = textOf(withMirror(text, groups));
    expect(changedLines(text, after)).toEqual({
      added: ["rounded:", "  sm: 4px"],
      removed: [],
    });
    expect(after.indexOf("rounded:")).toBeGreaterThan(
      after.indexOf("# The ink")
    );
  });

  it("rewrites a group in the yaml fence that holds it", () => {
    const text = [
      "## Colors",
      "",
      "```yaml",
      "colors:",
      "  paper: '#F4F0E4'",
      "```",
      "",
      "Paper is the canvas.",
      "",
    ].join("\n");
    const after = textOf(
      withMirror(text, { ...emptyGroups(), colors: { paper: "#FFFFFF" } })
    );
    expect(after).toBe(text.replace("'#F4F0E4'", '"#FFFFFF"'));
  });

  it("gives a file without front matter one, above the body", () => {
    const text = "# Handout\n\n## Overview\n\nAusterity.\n";
    const after = textOf(
      withMirror(text, { ...emptyGroups(), colors: { ink: "#1E1A14" } })
    );
    expect(after).toBe(`---\ncolors:\n  ink: "#1E1A14"\n---\n\n${text}`);
  });

  it("refuses to rewrite YAML that does not read", () => {
    const result = withMirror("---\ncolors: [\n---\n", {
      ...emptyGroups(),
      colors: { a: "#000" },
    });
    expect("problem" in result).toBe(true);
  });
});

describe("create", () => {
  it("writes a file that reads back as it was given, every section in order", () => {
    const groups: TokenGroups = {
      colors: { primary: "#1A1C1E" },
      components: {},
      rounded: { md: "8px" },
      spacing: { base: "0.25rem" },
      typography: {
        body: { fontFamily: "Public Sans", fontSize: "1rem", lineHeight: 1.5 },
      },
    };
    const text = create(groups, { name: "Heritage" });
    const doc = parse(text);
    expect(doc.problems).toEqual([]);
    expect(Object.keys(doc.values)).toEqual([
      "version",
      "name",
      "colors",
      "typography",
      "rounded",
      "spacing",
    ]);
    expect(doc.values.version).toBe("alpha");
    expect(doc.values.name).toBe("Heritage");
    expect(groupsOf(doc).groups).toEqual(groups);
    expect(doc.sections.map((s) => s.heading)).toEqual([
      "Overview",
      "Colors",
      "Typography",
      "Layout",
      "Elevation & Depth",
      "Shapes",
      "Components",
      "Do's and Don'ts",
    ]);
    expect(withMirror(text, groups)).toEqual({ changed: false, text });
  });
});

describe("renameRefs", () => {
  it("renames references in the front matter and the body alike", () => {
    const text =
      "---\ncomponents:\n  button:\n    backgroundColor: '{colors.tertiary}'\n---\nClay {colors.tertiary} is the sole accent; {colors.ink} carries the text.\n";
    expect(
      renameRefs(text, new Map([["colors.tertiary", "colors.accent"]]))
    ).toBe(text.replaceAll("{colors.tertiary}", "{colors.accent}"));
  });
});

describe("withSection", () => {
  const text =
    "---\nname: Acme\n---\n\n## Overview\n\nOld.\n\n## Shapes\n\nSharp.\n";

  it("replaces a section's text, the alias's heading kept", () => {
    expect(withSection(text, "Overview", "New, calm.")).toBe(
      "---\nname: Acme\n---\n\n## Overview\n\nNew, calm.\n\n## Shapes\n\nSharp.\n"
    );
    expect(withSection("## Brand & Style\n\nOld.\n", "Overview", "New.")).toBe(
      "## Brand & Style\n\nNew.\n"
    );
    expect(withSection(text, "Shapes", "Round.")).toBe(
      "---\nname: Acme\n---\n\n## Overview\n\nOld.\n\n## Shapes\n\nRound.\n"
    );
  });

  it("adds a section where the format orders it, or at the end", () => {
    expect(withSection(text, "Colors", "Ink.")).toBe(
      "---\nname: Acme\n---\n\n## Overview\n\nOld.\n\n## Colors\n\nInk.\n\n## Shapes\n\nSharp.\n"
    );
    expect(withSection(text, "Do's and Don'ts", "- Don't glow.")).toBe(
      `${text}\n## Do's and Don'ts\n\n- Don't glow.\n`
    );
    expect(parse(withSection(text, "Iconography", "Lucide.")).problems).toEqual(
      []
    );
  });
});
