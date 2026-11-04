import { assert, describe, it } from "@effect/vitest";
import type { InkLine, LaidBlock } from "./in-page.ts";
import { dividerFindings, spacingFindings } from "./measure.ts";

/** Lines of 18px from `top`, `gap` apart. */
const lines = (top: number, count: number, gap: number): InkLine[] =>
  Array.from({ length: count }, (_, i) => ({
    bottom: top + i * (18 + gap) + 18,
    top: top + i * (18 + gap),
  }));

const block = (
  label: string,
  ink: readonly InkLine[],
  children: readonly LaidBlock[] = []
): LaidBlock => ({
  bottom: ink.at(-1)?.bottom ?? 0,
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
  it("flags two groups set closer than the ratio times the gap between the rows below", () => {
    assert.deepStrictEqual(spacingFindings(panel, 3), [
      {
        above: "App components",
        below: "System components",
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

  it("flags a divider whose centre is off its bar's line, and not one within a pixel and a half", () => {
    assert.deepStrictEqual(
      dividerFindings([
        { bar: "Tools", centre: 50, sideCentre: 56 },
        { bar: "Tools", centre: 55, sideCentre: 56 },
      ]),
      [{ bar: "Tools", off: -6 }]
    );
  });
});
