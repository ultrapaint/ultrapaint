/**
 * The checks the editor runs on a page it drew for the review's picture (ADR 0081), on the frame
 * itself, a shadow root of the editor's page (ADR 0034): groups stacked closer than the skill asks
 * (3× between groups of rows, 2× between other groups) and rounded or filled rows touching. Only
 * the kinds the person rated real at 80% or more go; the server hands them to the designer.
 */
import type {
  FindingBox,
  RenderedFinding,
} from "@ultrapaint/contracts/screenshots";
import { spacingFindings } from "@ultrapaint/design-checks/findings";
import {
  auditInBrowser,
  type CheckRoot,
  layoutInBrowser,
} from "@ultrapaint/design-checks/in-page";

/** The box around two. */
const around = (a: FindingBox, b: FindingBox): FindingBox => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    x,
    y,
  };
};

/** What the checks find on the drawn page under `root`, each with where it is. */
export const renderedChecks = (
  root: Exclude<CheckRoot, string>
): readonly RenderedFinding[] => {
  const { block } = layoutInBrowser(root);
  const groups = block ? spacingFindings(block) : [];
  const { findings } = auditInBrowser({
    grid: 0,
    // `surfaces.md`'s tone step, which the surface checks read: they are not run here.
    nearTone: 0.045,
    only: ["touching-rows"],
    root,
    stress: false,
  });
  return [
    ...groups.map(
      (g): RenderedFinding => ({
        above: g.above,
        below: g.below,
        between: g.between,
        box: around(g.aboveBox, g.belowBox),
        kind: "groups-apart",
        ratio: g.ratio,
        within: g.within,
      })
    ),
    ...findings.flatMap((f): RenderedFinding[] =>
      f.check === "touching-rows" && f.box !== undefined
        ? [
            {
              box: f.box,
              kind: "touching-rows",
              list: f.label,
              rowHeight: f.value,
            },
          ]
        : []
    ),
  ];
};
