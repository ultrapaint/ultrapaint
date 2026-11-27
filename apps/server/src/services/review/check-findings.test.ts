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
      ["off-system", "Hand-set spacing 6px on Row 1 and others", "minor"],
      ["off-system", "Hand-set spacing 13px on Title", "minor"],
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
        "Hand-set spacing 13px on Title and others",
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

  it("name both pages by their whole routes when a shared fault is on two of one short name", () => {
    const touching = {
      box: { height: 84, width: 200, x: 0, y: 0 },
      kind: "touching-rows" as const,
      list: "Invoices",
      rowHeight: 28,
    };
    const found = checkFindings(
      ["/settings/billing", "/account/billing"].map((route) => ({
        checks: { offSystem: [], rendered: [touching] },
        file: `designs${route}.page.json`,
        route,
      }))
    );
    expect(found.map((f) => f.finding.where)).toEqual([
      "the rows of “Invoices”, on 2 pages (/settings/billing, /account/billing)",
    ]);
  });

  it("title a value off the system by its kind, its value as it reads and its first element", () => {
    const found = checkFindings([
      {
        checks: {
          offSystem: [
            {
              field: "fill",
              kind: "color",
              layer: "gradient",
              node: "Hero",
              value: "rgba(12, 10, 40, 0.6)",
            },
            {
              field: "font",
              kind: "font",
              node: "Heading",
              value:
                '"Instrument Sans", "Helvetica Neue", system-ui, sans-serif',
            },
            ...["Plan", "Plan", "Footer"].map((node) => ({
              field: "color",
              kind: "color" as const,
              node,
              value: "color-mix(in oklab, #1f2937 80%, transparent)",
            })),
          ],
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => f.finding.title)).toEqual([
      "Hand-set colour color-mix(…) on Plan and others",
      "Hand-set colour rgba(12, 10, 40, 0.6) in a gradient on Hero",
      'Hand-set font "Instrument Sans"… on Heading',
    ]);
  });

  it("keep a title near 60 characters, its element taking what is left", () => {
    const [found] = checkFindings([
      {
        checks: {
          offSystem: ["Pricing section heading", "Pricing section body"].map(
            (node) => ({
              field: "fill",
              kind: "color" as const,
              layer: "gradient" as const,
              node,
              value: "rgba(255, 255, 255, 0.08)",
            })
          ),
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found?.finding.title).toBe(
      "Hand-set colour rgba(…) in a gradient on Pricing… and others"
    );
  });

  it("put the whole value in the problem, and the fill layer it is in", () => {
    const font = '"Instrument Sans", "Helvetica Neue", system-ui, sans-serif';
    const found = checkFindings([
      {
        checks: {
          offSystem: [
            { field: "font", kind: "font", node: "Heading", value: font },
            {
              field: "fill",
              kind: "color",
              layer: "colour",
              node: "Band",
              value: "#fafafa",
            },
          ],
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => f.finding.problem)).toEqual([
      `off the system: ${font} font, 1 place, set by hand where the design system has a token.`,
      "off the system: #fafafa colour as a fill layer, 1 place, set by hand where the design system has a token.",
    ]);
  });

  it("keep each value's own title where two shorten alike", () => {
    const found = checkFindings([
      {
        checks: {
          offSystem: ["#1f2937 80%", "#1f2937 60%"].map((mix) => ({
            field: "color",
            kind: "color" as const,
            node: "Plan",
            value: `color-mix(in oklab, ${mix}, transparent)`,
          })),
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => f.finding.title)).toEqual([
      "Hand-set colour color-mix(in oklab, #1f2937 80%, transparent) on Plan",
      "Hand-set colour color-mix(in oklab, #1f2937 60%, transparent) on Plan",
    ]);
  });

  it("title groups set too close by their labels cut at a word, whole in the problem", () => {
    const found = checkFindings([
      {
        checks: {
          offSystem: [],
          rendered: [
            {
              above: "Choose the plan that fits your growing…",
              below: "Two plans",
              between: 10,
              box: { height: 50, width: 400, x: 0, y: 0 },
              kind: "groups-apart",
              ratio: 2,
              within: 8,
            },
          ],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => f.finding.title)).toEqual([
      "“Two plans” too close to “Choose the plan that fits…”",
    ]);
    expect(found[0]?.finding.problem).toContain(
      "between “Choose the plan that fits your growing…” and “Two plans”"
    );
  });

  it("name each page as the canvas names it, the home page too", () => {
    const weight = {
      field: "weight",
      kind: "weight" as const,
      node: "Title",
      value: 550,
    };
    const found = checkFindings(
      [
        { file: "designs/index.page.json", name: "Home", route: "/" },
        { file: "designs/about.page.json", name: "About", route: "/about" },
      ].map((page) => ({
        checks: { offSystem: [weight], rendered: [] },
        ...page,
      }))
    );
    expect(found.map((f) => f.finding.where)).toEqual([
      "Title (`weight`) on Home, Title (`weight`) on About, on 2 pages",
    ]);
  });

  it("name the home page by its route where the canvas's name is not known", () => {
    const weight = {
      field: "weight",
      kind: "weight" as const,
      node: "Title",
      value: 550,
    };
    const found = checkFindings(
      [
        { file: "designs/index.page.json", route: "/" },
        { file: "designs/about.page.json", route: "/about" },
      ].map((page) => ({
        checks: { offSystem: [weight], rendered: [] },
        ...page,
      }))
    );
    expect(found.map((f) => f.finding.where)).toEqual([
      "Title (`weight`) on /, Title (`weight`) on about, on 2 pages",
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
