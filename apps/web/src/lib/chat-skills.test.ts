import type { Skill } from "@ultrapaint/contracts/skills";
import { describe, expect, it } from "vitest";
import { chosenSkills, skillKey } from "./chat-skills.ts";

const skill = (o: Partial<Skill> & Pick<Skill, "name">): Skill => ({
  enabled: false,
  source: "project",
  summary: "",
  text: "",
  title: o.name,
  ...o,
});

const design = skill({ enabled: true, name: "ultrapaint", source: "built-in" });
const voice = skill({
  enabled: true,
  file: "docs/designs/skills/voice.md",
  name: "voice",
});
const grilling = skill({
  file: ".claude/skills/grilling/SKILL.md",
  name: "grilling",
});

describe("a chat's design skills", () => {
  it("names the design skill by its name and a project's by its file", () => {
    expect([design, voice].map(skillKey)).toEqual([
      "ultrapaint",
      "docs/designs/skills/voice.md",
    ]);
  });

  it("are the project's defaults until the chat chooses its own", () => {
    expect(chosenSkills({}, [design, voice, grilling])).toEqual([
      "ultrapaint",
      "docs/designs/skills/voice.md",
    ]);
  });

  it("are the chat's own once it chose, none included", () => {
    expect(
      chosenSkills({ skills: [".claude/skills/grilling/SKILL.md"] }, [
        design,
        grilling,
      ])
    ).toEqual([".claude/skills/grilling/SKILL.md"]);
    expect(chosenSkills({ skills: [] }, [design])).toEqual([]);
  });
});
