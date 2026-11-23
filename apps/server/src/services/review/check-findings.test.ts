import { describe, expect, it } from "vitest";
import { checkFindings } from "./check-findings.ts";

const value = (
  node: string,
  v: number | string,
  kind = "spacing" as const
) => ({
  field: "padding.top",
  kind,
  node,
  value: v,
});

describe("the checks' findings for the designer", () => {
  it("group the values off the system by value, the most places first, naming five and counting the rest", () => {
    const found = checkFindings([
      {
        checks: {
          offSystem: [
            value("Title", 13),
            ...Array.from({ length: 8 }, (_, i) => value(`Row ${i + 1}`, 6)),
          ],
          rendered: [],
        },
        file: "designs/home.page.json",
      },
      {
        checks: { offSystem: [value("Footer", 6)], rendered: [] },
        file: "designs/settings.page.json",
        route: "/settings",
      },
    ]);
    expect(
      found.map((f) => [f.check, f.finding.title, f.finding.severity])
    ).toEqual([
      ["off-system", "6px spacing off the system", "minor"],
      ["off-system", "13px spacing off the system", "minor"],
    ]);
    const [six] = found;
    expect(six?.finding.problem).toBe(
      "off the system: 6px spacing, 9 places, set by hand where the design system has a token."
    );
    expect(six?.finding.where).toBe(
      "Row 1 (`padding.top`) on home, Row 2 (`padding.top`) on home, Row 3 (`padding.top`) on home, Row 4 (`padding.top`) on home, Row 5 (`padding.top`) on home and 4 more, on 2 pages"
    );
  });

  it("are one finding for a fault two pages share, naming both", () => {
    const touching = {
      box: { height: 84, width: 200, x: 0, y: 0 },
      kind: "touching-rows" as const,
      list: "Files",
      rowHeight: 28,
    };
    const found = checkFindings(
      ["empty", "full"].map((state) => ({
        checks: { offSystem: [], rendered: [touching] },
        file: `designs/files-${state}.page.json`,
      }))
    );
    expect(found.map((f) => [f.finding.title, f.finding.where])).toEqual([
      [
        "Rows touching in “Files”",
        "the rows of “Files”, on 2 pages (files-empty, files-full)",
      ],
    ]);
  });

  it("are one finding for one value however it is written", () => {
    const found = checkFindings([
      {
        checks: {
          offSystem: [value("Title", 13), value("Card", "13px")],
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => [f.finding.title, f.finding.where])).toEqual([
      [
        "13px spacing off the system",
        "Title (`padding.top`), Card (`padding.top`)",
      ],
    ]);
  });

  it("name the page of each place when a value is off on several", () => {
    const found = checkFindings(
      ["home", "settings"].map((page) => ({
        checks: { offSystem: [value("Footer", 6)], rendered: [] },
        file: `designs/${page}.page.json`,
      }))
    );
    expect(found.map((f) => f.finding.where)).toEqual([
      "Footer (`padding.top`) on home, Footer (`padding.top`) on settings, on 2 pages",
    ]);
  });

  it("name the page a measured fault is on when several were measured", () => {
    const touching = {
      box: { height: 84, width: 200, x: 0, y: 0 },
      kind: "touching-rows" as const,
      list: "Files",
      rowHeight: 28,
    };
    const found = checkFindings([
      {
        checks: { offSystem: [], rendered: [touching] },
        file: "designs/files.page.json",
      },
      {
        checks: { offSystem: [], rendered: [{ ...touching, list: "Folders" }] },
        file: "designs/folders.page.json",
      },
    ]);
    expect(found.map((f) => f.finding.where)).toEqual([
      "the rows of “Files” on files",
      "the rows of “Folders” on folders",
    ]);
  });

  it("name a page by its whole route where two share a short name", () => {
    const found = checkFindings(
      ["/settings/billing", "/account/billing"].map((route) => ({
        checks: { offSystem: [value("Footer", 6)], rendered: [] },
        file: `designs${route}.page.json`,
        route,
      }))
    );
    expect(found.map((f) => f.finding.where)).toEqual([
      "Footer (`padding.top`) on /settings/billing, Footer (`padding.top`) on /account/billing, on 2 pages",
    ]);
  });

  it("are none when nothing was measured wrong", () => {
    expect(
      checkFindings([
        {
          checks: { offSystem: [], rendered: [] },
          file: "designs/home.page.json",
        },
        { file: "designs/unread.page.json" },
      ])
    ).toEqual([]);
  });
});
