import type { PageNode } from "@ultrapaint/contracts/document";
import type { RoundFinding } from "@ultrapaint/contracts/threads";
import {
  type OffSystemKind,
  offSystemValues,
} from "@ultrapaint/design-document/off-system";
import { describe, expect, it } from "vitest";
import {
  type CheckedPage,
  checksOf,
  checksOnChanges,
} from "./check-findings.ts";
import { toRoundFinding } from "./review-rounds.ts";

/** The checks' findings on the pages, none declined before. */
const checkFindings = (pages: readonly CheckedPage[]) => checksOf(pages).found;

const value = (
  node: string,
  v: number | string,
  kind: OffSystemKind = "spacing"
) => ({
  field: "padding.top",
  fields: `[["padding.top",${JSON.stringify(v)}]]`,
  id: `n_${node}`,
  kind,
  node,
  value: v,
});

describe("the checks' findings for the designer", () => {
  it("group the values off the system by kind, the values with the most places first, naming five places and counting the rest", () => {
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
      ["off-system", "10 hand-set spacing values on Row 1 and others", "minor"],
    ]);
    const [spacing] = found;
    expect(spacing?.finding.problem).toBe(
      "off the system: 10 spacing values set by hand where the design system has a token: 6px (9 places), 13px (1 place)."
    );
    expect(spacing?.finding.where).toBe(
      "Row 1 (`padding.top`) on home, Row 2 (`padding.top`) on home, Row 3 (`padding.top`) on home, Row 4 (`padding.top`) on home, Row 5 (`padding.top`) on home and 5 more, on 2 pages"
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
              ...value("Hero", "rgba(12, 10, 40, 0.6)", "color"),
              field: "fill",
              kind: "color",
              layer: "gradient",
            },
            {
              ...value("Heading", "", "font"),
              field: "font",
              kind: "font",
              value:
                '"Instrument Sans", "Helvetica Neue", system-ui, sans-serif',
            },
            ...["Plan", "Plan", "Footer"].map((node) => ({
              ...value(node, "", "color"),
              field: "color",
              kind: "color" as const,
              value: "color-mix(in oklab, #1f2937 80%, transparent)",
            })),
          ],
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => f.finding.title)).toEqual([
      "4 hand-set colours on Plan and others",
      'Hand-set font "Instrument Sans"… on Heading',
    ]);
  });

  it("keep a title near 60 characters, its element taking what is left", () => {
    const [found] = checkFindings([
      {
        checks: {
          offSystem: ["Pricing section heading", "Pricing section body"].map(
            (node) => ({
              ...value(node, ""),
              field: "fill",
              kind: "color" as const,
              layer: "gradient" as const,
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
            { ...value("Heading", font), field: "font", kind: "font" },
            {
              ...value("Band", "#fafafa"),
              field: "fill",
              kind: "color",
              layer: "colour",
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

  it("name each value of a kind in its problem, whole, with the places it has", () => {
    const found = checkFindings([
      {
        checks: {
          offSystem: ["#1f2937 80%", "#1f2937 60%", "#1f2937 80%"].map(
            (mix, i) => ({
              ...value(i === 2 ? "Card" : "Plan", ""),
              field: "color",
              kind: "color" as const,
              value: `color-mix(in oklab, ${mix}, transparent)`,
            })
          ),
          rendered: [],
        },
        file: "designs/home.page.json",
      },
    ]);
    expect(found.map((f) => [f.finding.title, f.finding.problem])).toEqual([
      [
        "3 hand-set colours on Plan and others",
        "off the system: 3 colours set by hand where the design system has a token: color-mix(in oklab, #1f2937 80%, transparent) (2 places), color-mix(in oklab, #1f2937 60%, transparent) (1 place).",
      ],
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
      ...value("Title", 550),
      field: "weight",
      kind: "weight" as const,
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
      ...value("Title", 550),
      field: "weight",
      kind: "weight" as const,
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

/** A page whose title's text size and weight are set by hand, and its card's padding. */
const hero = (titleSize: number, cardPadding = 13): PageNode => ({
  children: [
    {
      id: "c_title",
      name: "Title",
      role: "heading",
      size: titleSize,
      text: "Pricing",
      type: "text",
      weight: 550,
    },
    {
      children: [],
      id: "c_card",
      name: "Card",
      padding: cardPadding,
      type: "column",
    },
  ],
  id: "c_root",
  type: "page",
});

const HOME = "designs/home.page.json";

const checkedHero = (root: PageNode): CheckedPage => ({
  checks: { offSystem: offSystemValues(root), rendered: [] },
  file: HOME,
});

/** The round's findings, the designer declining those whose titles start with `declining`. */
const declinedIn = (page: CheckedPage, declining: string) =>
  checksOf([page]).found.flatMap((f): RoundFinding[] =>
    f.finding.title.startsWith(declining)
      ? [{ ...toRoundFinding(f), declined: "the brand's type" }]
      : []
  );

describe("a check's finding declined before", () => {
  it("holds back what the checks measure again while its node's fields of its kind are the same", () => {
    const declined = declinedIn(checkedHero(hero(15)), "Hand-set text size");
    expect(declined.map((d) => d.title)).toEqual([
      "Hand-set text size 15px on Title",
    ]);
    // The title's text changed, and its weight: its text size is the same.
    const again = hero(15);
    const changed = {
      ...again,
      children: [
        { ...again.children[0], text: "Plans", weight: 600 },
        ...again.children.slice(1),
      ],
    } as PageNode;
    const { carried, found } = checksOf([checkedHero(changed)], declined);
    expect(found.map((f) => f.finding.title)).toEqual([
      "Hand-set weight 600 on Title",
      "Hand-set spacing 13px on Card",
    ]);
    expect(carried.map((c) => [c.title, c.declined, c.carried])).toEqual([
      ["Hand-set text size 15px on Title", "the brand's type", true],
    ]);
  });

  it("holds nothing back once a node it names has other fields of its kind", () => {
    const declined = declinedIn(checkedHero(hero(15)), "Hand-set text size");
    const { carried, found } = checksOf([checkedHero(hero(17))], declined);
    expect(found.map((f) => f.finding.title)).toContain(
      "Hand-set text size 17px on Title"
    );
    expect(carried).toEqual([]);
  });

  it("holds back a rendered check's finding while its blocks' labels and what it measured are the same", () => {
    const groups = {
      above: "App components",
      below: "System components",
      between: 27,
      box: { height: 287, width: 200, x: 0, y: 259 },
      kind: "groups-apart" as const,
      ratio: 3,
      within: 10,
    };
    const on = (measured: typeof groups): CheckedPage => ({
      checks: { offSystem: [], rendered: [measured] },
      file: HOME,
    });
    const declined = checksOf([on(groups)]).found.map(
      (f): RoundFinding => ({ ...toRoundFinding(f), declined: "one panel" })
    );
    expect(checksOf([on(groups)], declined).found).toEqual([]);
    expect(
      checksOf([on({ ...groups, box: { ...groups.box, y: 300 } })], declined)
        .found
    ).toEqual([]);
    expect(
      checksOf([on({ ...groups, between: 24 })], declined).found.map(
        (f) => f.finding.title
      )
    ).toEqual(["“System components” too close to “App components”"]);
    expect(
      checksOf([on({ ...groups, below: "Templates" })], declined).found
    ).toHaveLength(1);
  });

  it("is a decline of the page it was on, not of a node of the same id on another", () => {
    const declined = declinedIn(checkedHero(hero(15)), "Hand-set text size");
    const { found } = checksOf(
      [{ ...checkedHero(hero(15)), file: "designs/about.page.json" }],
      declined
    );
    expect(found.map((f) => f.finding.title)).toContain(
      "Hand-set text size 15px on Title"
    );
  });
});

describe("the checks on what the turns changed", () => {
  it("read the values of the nodes the turns changed, and every block of a page they changed", () => {
    const touching = {
      box: { height: 84, width: 200, x: 0, y: 0 },
      kind: "touching-rows" as const,
      list: "Files",
      rowHeight: 28,
    };
    const after = hero(15, 15);
    const checks = { offSystem: offSystemValues(after), rendered: [touching] };
    const scoped = checksOnChanges(checks, hero(15), after);
    expect(scoped.offSystem.map((v) => [v.id, v.field, v.value])).toEqual([
      ["c_card", "padding", 15],
    ]);
    expect(scoped.rendered).toEqual([touching]);
  });

  it("read nothing on a page the turns left as it was", () => {
    const checks = {
      offSystem: offSystemValues(hero(15)),
      rendered: [
        {
          box: { height: 84, width: 200, x: 0, y: 0 },
          kind: "touching-rows" as const,
          list: "Files",
          rowHeight: 28,
        },
      ],
    };
    expect(checksOnChanges(checks, hero(15), hero(15))).toEqual({
      offSystem: [],
      rendered: [],
    });
  });

  it("read a page the turns made, or one with no before, whole", () => {
    const checks = { offSystem: offSystemValues(hero(15)), rendered: [] };
    expect(checksOnChanges(checks, null, hero(15))).toBe(checks);
    expect(checksOnChanges(checks, undefined, hero(15))).toBe(checks);
  });
});
