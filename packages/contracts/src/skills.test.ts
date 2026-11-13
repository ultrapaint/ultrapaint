import { describe, expect, it } from "vitest";
import { skillFrontMatter } from "./skills.ts";

describe("a skill's front matter", () => {
  it("gives its name and description, quoted or not", () => {
    expect(
      skillFrontMatter(
        '---\nname: tdd\ndescription: "Test-driven development."\nother: x\n---\n# TDD\n'
      )
    ).toEqual({ description: "Test-driven development.", name: "tdd" });
  });

  it("folds a description over its indented lines", () => {
    expect(
      skillFrontMatter(
        "---\nname: grilling\ndescription: >\n  Grill the user\n  about a plan.\nlicense: MIT\n---\nbody\n"
      )
    ).toEqual({
      description: "Grill the user about a plan.",
      name: "grilling",
    });
  });

  it("is empty for a file with none", () => {
    expect(skillFrontMatter("# Voice\n\nPlain words.\n")).toEqual({});
  });
});
