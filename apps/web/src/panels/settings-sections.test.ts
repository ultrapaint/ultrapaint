import { describe, expect, it } from "vitest";
import {
  SECTIONS,
  SETTINGS_INDEX,
  searchSettings,
  sectionNamed,
} from "./settings-sections.ts";

describe("the settings' search", () => {
  it("finds a setting by its name, its own first", () => {
    expect(searchSettings("text size")[0]?.id).toBe("text-size");
    expect(searchSettings("send")[0]?.id).toBe("send-key");
  });

  it("finds a setting by the words it is looked for by", () => {
    expect(searchSettings("dark").map((e) => e.id)).toContain("theme");
    expect(searchSettings("hotkeys").map((e) => e.id)).toEqual(["shortcuts"]);
  });

  it("leaves out the sections not shown", () => {
    expect(
      searchSettings("review", (s) => s !== "review").some(
        (e) => e.section === "review"
      )
    ).toBe(false);
  });

  it("finds nothing for nothing typed", () => {
    expect(searchSettings("  ")).toEqual([]);
  });

  it("names each setting once, in a section that exists", () => {
    const ids = SETTINGS_INDEX.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SETTINGS_INDEX) {
      expect(SECTIONS.some((s) => s.id === e.section)).toBe(true);
    }
  });
});

describe("a section's name", () => {
  it("takes the earlier Preferences to General, and refuses one that doesn't exist", () => {
    expect(sectionNamed("editor")).toBe("general");
    expect(sectionNamed("review")).toBe("review");
    expect(sectionNamed("nowhere")).toBeNull();
  });
});
