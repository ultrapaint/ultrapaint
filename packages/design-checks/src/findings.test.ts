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
  children,
  label,
  lines: ink,
  top: ink[0]?.top ?? 0,
});

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
        within: 10,
      },
    ]);
    assert.deepStrictEqual(spacingFindings(panel, 2), []);
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
