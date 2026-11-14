// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { describe, expect, it, vi } from "vitest";
import { skillToggled } from "./settings-agents.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const design = { name: "ultrapaint", source: "built-in" as const };
const grilling = {
  file: ".claude/skills/grilling/SKILL.md",
  name: "grilling",
  source: "project" as const,
};

describe("a skill turned on or off", () => {
  it("turns a project's skill on by its file, kept in the settings", () => {
    expect(skillToggled(undefined, grilling, true)).toEqual({
      enabled: [".claude/skills/grilling/SKILL.md"],
    });
    expect(
      skillToggled({ enabled: [grilling.file] }, grilling, false)
    ).toBeUndefined();
  });

  it("turns a linked skill off whichever of its files the settings name, and on by its own", () => {
    const linked = {
      ...grilling,
      aliases: [".agents/skills/grilling/SKILL.md"],
    };
    expect(
      skillToggled(
        { enabled: [".agents/skills/grilling/SKILL.md"] },
        linked,
        false
      )
    ).toBeUndefined();
    expect(
      skillToggled(
        { enabled: [".agents/skills/grilling/SKILL.md"] },
        linked,
        true
      )
    ).toEqual({ enabled: [".claude/skills/grilling/SKILL.md"] });
  });

  it("turns the design skill off by its name, and on again by leaving it out", () => {
    const off = skillToggled({ briefing: "full" }, design, false);
    expect(off).toEqual({ briefing: "full", disabled: ["ultrapaint"] });
    expect(skillToggled(off, design, true)).toEqual({ briefing: "full" });
  });
});
