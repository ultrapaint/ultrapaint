// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { describe, expect, it, vi } from "vitest";
import { problemRow, waitingSections } from "./settings.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

describe("a refused save's reasons", () => {
  it("go under the row they are about", () => {
    expect(problemRow("Repository path does not exist: /nowhere")).toBe("path");
    expect(problemRow("Designs directory does not exist: docs/x")).toBe(
      "designs"
    );
    expect(
      problemRow(
        "The package pages resolve their imports from has no package.json: apps/x"
      )
    ).toBe("application");
    expect(problemRow("Library directory does not exist: src/ui")).toBe(
      "components"
    );
  });

  it("stay in the footer when no row holds them", () => {
    expect(problemRow("Settings were set in the meantime.")).toBeNull();
  });
});

describe("the sections whose edits wait for a save", () => {
  const saved = defaultSettings("/repo");

  it("are none while the draft is what was saved", () => {
    expect(waitingSections({ detected: false, draft: saved, saved })).toEqual(
      []
    );
  });

  it("are each section holding an edit, in the sidebar's order", () => {
    const draft = { ...saved, designsDir: "docs/other", hostCss: ["a.css"] };
    expect(waitingSections({ detected: false, draft, saved })).toEqual([
      "repository",
      "designSystem",
    ]);
  });

  it("are the Agents when the review changed", () => {
    const draft = { ...saved, review: { eachRound: "all" as const } };
    expect(waitingSections({ detected: false, draft, saved })).toEqual([
      "agents",
    ]);
  });

  it("are the Repository when the settings were detected or never saved", () => {
    expect(waitingSections({ detected: true, draft: saved, saved })).toEqual([
      "repository",
    ]);
    expect(
      waitingSections({ detected: false, draft: saved, saved: null })
    ).toEqual(["repository"]);
  });
});
