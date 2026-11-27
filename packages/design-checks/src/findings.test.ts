import { assert, describe, expect, it } from "vitest";
import { dividerFindings, hoverFindings, spacingFindings } from "./findings.ts";
import type { InkLine, LaidBlock } from "./in-page.ts";

/** Lines of 18px from `top`, `gap` apart. */
const lines = (top: number, count: number, gap: number): InkLine[] =>
  Array.from({ length: count }, (_, i) => ({
    bottom: top + i * (18 + gap) + 18,
    top: top + i * (18 + gap),
  }));

/** A block's box from its lines: 200px wide at the root's left edge. */
const boxOf = (ink: readonly InkLine[]) => ({
  height: (ink.at(-1)?.bottom ?? 0) - (ink[0]?.top ?? 0),
  width: 200,
  x: 0,
  y: ink[0]?.top ?? 0,
});

const block = (
  label: string,
  ink: readonly InkLine[],
  children: readonly LaidBlock[] = []
): LaidBlock => ({
  bottom: ink.at(-1)?.bottom ?? 0,
  box: boxOf(ink),
  boxed: false,
  children,
  label,
  lines: ink,
  region: false,
  top: ink[0]?.top ?? 0,
});

/** The blocks of `children` under one block, their lines its lines. */
const groupOf = (label: string, children: readonly LaidBlock[]) =>
  block(
    label,
    children.flatMap((c) => c.lines),
    children
  );

/**
 * A box of its own from `top`, `height` tall, with one line of text centred in it: a bordered or
 * filled card, a field, a notice.
 */
const boxAt = (label: string, top: number, height: number): LaidBlock => {
  const line = {
    bottom: top + (height + 18) / 2,
    top: top + (height - 18) / 2,
  };
  return {
    ...block(label, [line]),
    bottom: top + height,
    box: { height, width: 200, x: 0, y: top },
    boxed: true,
    top,
  };
};

// The Components panel as measured on the redesign: the App group ends at 361, the System group
// starts 27px lower and its rows are 10px apart.
const app = block(
  "App components",
  lines(212, 4, 10).map((l) => ({
    ...l,
    bottom: l.bottom + 47,
    top: l.top + 47,
  }))
);
const system = block("System components", lines(388, 6, 10));
const panel = block(
  "Components",
  [...app.lines, ...system.lines],
  [app, system]
);

describe("measure", () => {
  it("flags two groups set closer than the ratio times the gap between the rows below, with where both are", () => {
    assert.deepStrictEqual(spacingFindings(panel, 3), [
      {
        above: "App components",
        aboveBox: { height: 102, width: 200, x: 0, y: 259 },
        below: "System components",
        belowBox: { height: 158, width: 200, x: 0, y: 388 },
        between: 27,
        ratio: 3,
        within: 10,
      },
    ]);
    assert.deepStrictEqual(spacingFindings(panel, 2), []);
  });

  it("asks 3× of a stacked list of rows and 2× of a paragraph: both flagged at 2.7× only as rows", () => {
    /** Each line of `ink` a row of its own, as a list's rows are its parts. */
    const rowsOf = (label: string, ink: readonly InkLine[]) =>
      block(
        label,
        ink,
        ink.map((line, i) => block(`${label} ${i + 1}`, [line]))
      );
    // 27px between the groups, 10px between the lines of the one below: 2.7×.
    const above = block("Intro", lines(100, 2, 10));
    const at = (above.lines.at(-1)?.bottom ?? 0) + 27;
    const groupsOf = (below: LaidBlock) =>
      block("Panel", [...above.lines, ...below.lines], [above, below]);

    const list = groupsOf(rowsOf("Files", lines(at, 4, 10)));
    assert.deepStrictEqual(
      spacingFindings(list).map((f) => [f.below, f.between, f.ratio]),
      [["Files", 27, 3]]
    );
    const paragraph = groupsOf(block("Body", lines(at, 4, 10)));
    assert.deepStrictEqual(spacingFindings(paragraph), []);
  });

  it("takes a single line closer to the block below than to the one above as its heading", () => {
    const rows = block("rows", lines(200, 4, 10));
    const heading = block("Snapshots", [{ bottom: 190, top: 172 }]);
    const panelOf = (above: LaidBlock) =>
      block(
        "Changes",
        [...above.lines, ...heading.lines, ...rows.lines],
        [above, heading, rows]
      );
    // 38px above the label, 10px below it: the label heads the rows.
    assert.deepStrictEqual(
      spacingFindings(panelOf(block("files", lines(60, 3, 10))), 3),
      []
    );
    // 7px above it: the label sits with the files, and the rows are a group 10px away.
    assert.deepStrictEqual(
      spacingFindings(panelOf(block("files", lines(91, 3, 10))), 3).map(
        (f) => f.above
      ),
      ["Snapshots"]
    );
  });

  it("leaves blocks side by side alone: a row is not a stack", () => {
    const rail = block("rail", lines(100, 3, 10));
    const side = { ...block("panel", lines(100, 3, 10)), top: 100 };
    assert.deepStrictEqual(
      spacingFindings(block("card", [...rail.lines], [rail, side]), 3),
      []
    );
  });

  it("takes bordered or filled boxes as groups set apart by their edges: nothing between a block and the cards under it, nor between the cards", () => {
    // Two lines of intro, then three option cards 60px tall, 12px apart, 24px under the intro.
    const intro = block("Choose a plan", lines(100, 2, 6));
    const cards = groupOf(
      "Plans",
      [0, 1, 2].map((i) => boxAt(`Plan ${i + 1}`, 166 + i * 72, 60))
    );
    assert.deepStrictEqual(
      spacingFindings(groupOf("Page", [intro, cards])),
      []
    );
  });

  it("measures a text beside a card with what is under them, from the card's edge", () => {
    const beside = groupOf("Pro", [
      {
        ...block("Pro", lines(100, 2, 6)),
        box: { height: 42, width: 200, x: 0, y: 100 },
      },
      {
        ...boxAt("$12 a month", 100, 60),
        box: { height: 60, width: 200, x: 220, y: 100 },
      },
    ]);
    // 12px under the card's edge, the paragraph's lines 10px apart: under 2×.
    const paragraph = block("Billed yearly", lines(172, 3, 10));
    assert.deepStrictEqual(
      spacingFindings(groupOf("Plan", [beside, paragraph])).map((f) => [
        f.above,
        f.between,
        f.within,
      ]),
      [["Pro", 12, 10]]
    );
  });

  it("never measures a page's header band against the content under it", () => {
    // A filled band of two lines across the top, the content 16px under it.
    const band = {
      ...block("Acme", lines(10, 2, 4)),
      boxed: true,
      region: true,
    };
    const content = block("Settings", lines(66, 4, 10));
    assert.deepStrictEqual(
      spacingFindings(groupOf("App", [band, content])),
      []
    );
  });

  it("never measures a scrolling panel against what sits under it", () => {
    const scrolling = { ...block("Files", lines(100, 5, 10)), region: true };
    const footer = block("12 files · 3 changed", lines(244, 2, 10));
    assert.deepStrictEqual(
      spacingFindings(groupOf("Sidebar", [scrolling, footer])),
      []
    );
  });

  it("reads a notice with the fields it sits on", () => {
    const notice = {
      ...boxAt("Your card was declined", 100, 56),
      lines: lines(110, 2, 2),
    };
    const fields = groupOf("Card", [
      block("Card number", [{ bottom: 186, top: 168 }]),
      boxAt("1234 5678", 192, 40),
      block("Expiry", [{ bottom: 266, top: 248 }]),
      boxAt("MM / YY", 272, 40),
    ]);
    assert.deepStrictEqual(
      spacingFindings(groupOf("Payment", [notice, fields])),
      []
    );
  });

  it("measures a group of labels and fields from the fields' edges: their padding is space within them", () => {
    // Labels 6px over their fields, 16px under the field above: 6px within.
    const fieldsAt = (top: number) =>
      groupOf("Contact", [
        block("Name", [{ bottom: top + 18, top }]),
        boxAt("Ada", top + 24, 40),
        block("Email", [{ bottom: top + 98, top: top + 80 }]),
        boxAt("ada@example.com", top + 104, 40),
      ]);
    const intro = block("Tell us about you", lines(100, 2, 6));
    // 20px under the intro: over 2× the 6px within, though under 2× the 17px from a label to
    // its field's text.
    assert.deepStrictEqual(
      spacingFindings(groupOf("Form", [intro, fieldsAt(162)])),
      []
    );
    // 10px under it: under 2×.
    assert.deepStrictEqual(
      spacingFindings(groupOf("Form", [intro, fieldsAt(152)])).map((f) => [
        f.between,
        f.within,
      ]),
      [[10, 6]]
    );
  });

  it("flags a divider whose centre is off its bar's line, with where it is, and not one within a pixel and a half", () => {
    const rule = { height: 16, width: 1, x: 120, y: 42 };
    assert.deepStrictEqual(
      dividerFindings([
        { bar: "Tools", box: rule, centre: 50, sideCentre: 56 },
        { bar: "Tools", box: rule, centre: 55, sideCentre: 56 },
      ]),
      [{ bar: "Tools", box: rule, off: -6 }]
    );
  });
});

describe("the hover pass", () => {
  const finding = (check: "control-fill" | "touching-rows", label: string) => ({
    check,
    detail: "d",
    label,
    value: 1,
  });

  it("adds what shows only on hover: findings not seen at rest, and controls not shown at rest", () => {
    expect(
      hoverFindings({
        hover: {
          controls: ["Rename", "Delete", "Show"],
          findings: [
            finding("touching-rows", "Files"),
            finding("control-fill", "Picker"),
          ],
        },
        rest: {
          controls: ["Show"],
          findings: [finding("control-fill", "Picker")],
        },
      }).map((f) => [f.check, f.label, f.on])
    ).toEqual([
      ["control-fill", "Picker", "rest"],
      ["touching-rows", "Files", "hover"],
      ["hover-only", "Rename", "hover"],
      ["hover-only", "Delete", "hover"],
    ]);
  });

  it("puts a control shown only on hover where the hover pass found it", () => {
    const box = { height: 24, width: 24, x: 300, y: 80 };
    const [found] = hoverFindings({
      hover: {
        controlBoxes: { Rename: box },
        controls: ["Rename"],
        findings: [],
      },
      rest: { controls: [], findings: [] },
    });
    expect(found?.box).toEqual(box);
  });
});
