import { describe, expect, it } from "vitest";
import { documentChecks } from "./page-views.ts";

describe("the checks a reviewer is told", () => {
  it("counts the values off the system by kind and names the first twelve", () => {
    const values = Array.from({ length: 14 }, (_, i) => ({
      field: "padding.top",
      kind: i < 13 ? ("spacing" as const) : ("color" as const),
      node: `Row ${i + 1}`,
      value: i < 13 ? 13 : "#ff0000",
    }));
    const said = documentChecks(values);
    expect(said).toContain(
      "14 values are set by hand where the design system has a token (13 spacing, 1 color):"
    );
    expect(said).toContain("- Row 1: `padding.top` 13");
    expect(said).not.toContain("Row 13:");
    expect(said).toContain("- and 2 more.");
  });

  it("says when there is none", () => {
    expect(documentChecks([])).toBe(
      "No value is set by hand where the design system has a token."
    );
  });
});
