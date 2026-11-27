/**
 * What the layout a page was read as (`layoutInBrowser`) and its audits say is wrong, as pure
 * functions of what was read:
 *
 * - **Groups apart:** the gap between two blocks stacked one above the other is at least a ratio
 *   times the gap between the lines of the block below (the core's Spacing: "the gap between
 *   groups is at least 2× the gap within one, measured between the text"; stacked groups of rows
 *   take 3×, or they read as one list). Gaps are measured between lines of text, not boxes: a
 *   row's padding is space within it. A box of its own (a border, a shadow or a fill apart from
 *   what it sits on) is one group, measured edge to edge: its padding is space within it, and its
 *   edge sets it apart whatever the gap, so it is never measured against its neighbour; nor is
 *   a block made only of boxes (a list of cards), nor a region of the page (a header band, a
 *   scrolling panel). The ratio is the whitespace rule for groups that have no edge.
 * - **Dividers centred:** a thin vertical rule's centre is its neighbours' (the tools' line).
 * - **Hover:** what an audit found only with the controls drawn as hovered.
 */
import type {
  Audited,
  AuditFinding,
  Box,
  InkLine,
  LaidBlock,
  LaidRule,
} from "./in-page.ts";

export interface SpacingFinding {
  readonly above: string;
  /** The block above, from the root's top left corner. */
  readonly aboveBox: Box;
  readonly below: string;
  /** The block below, from the root's top left corner. */
  readonly belowBox: Box;
  /** From the last line of the block above to the first of the block below. */
  readonly between: number;
  /** The ratio it falls under: the one for groups of rows, or the one for other groups. */
  readonly ratio: number;
  /** The median gap between the lines of the block below. */
  readonly within: number;
}

/**
 * How many times the gap within a group the gap between groups is at least: `rows` when the
 * block below is a group of rows (`isRows`), `other` for any other group.
 */
export interface GroupRatios {
  readonly other: number;
  readonly rows: number;
}

/** The core's Spacing: 3× between stacked groups of rows, 2× between other groups. */
export const GROUP_RATIOS: GroupRatios = { other: 2, rows: 3 };

export interface DividerFinding {
  readonly bar: string;
  /** The rule, from the root's top left corner. */
  readonly box: Box;
  /** How far the rule's centre is from its neighbours', down positive. */
  readonly off: number;
}

/** Off by more than this, in CSS pixels, a divider is not on its bar's line. */
const DIVIDER_TOLERANCE = 1.5;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const gapsOf = (lines: readonly InkLine[]) =>
  lines.slice(1).flatMap((line, i) => {
    const before = lines[i];
    return before === undefined ? [] : [line.top - before.bottom];
  });

/**
 * The blocks under `block` that stand apart by an edge of their own: each box or region, the
 * outermost of each.
 */
const apartIn = (block: LaidBlock): readonly LaidBlock[] =>
  block.children.flatMap((c) => (c.boxed || c.region ? [c] : apartIn(c)));

/** Whether a line lies within a block's top and bottom. */
const liesIn = (line: InkLine, b: LaidBlock) =>
  line.top >= b.top - 0.5 && line.bottom <= b.bottom + 0.5;

/** Lines that overlap made one, top to bottom. */
const union = (spans: readonly InkLine[]) => {
  const merged: InkLine[] = [];
  for (const span of [...spans].sort((a, b) => a.top - b.top)) {
    const last = merged.at(-1);
    if (last && span.top < last.bottom) {
      merged[merged.length - 1] = {
        bottom: Math.max(last.bottom, span.bottom),
        top: last.top,
      };
    } else {
      merged.push(span);
    }
  }
  return merged;
};

/**
 * A block's lines as a reader sees them: each box or region under it one line from its top edge
 * to its bottom, the text inside it none of the block's.
 */
const inkOf = (block: LaidBlock): readonly InkLine[] => {
  const apart = apartIn(block);
  return apart.length === 0
    ? block.lines
    : union([
        ...block.lines.filter((l) => !apart.some((a) => liesIn(l, a))),
        ...apart.map((a) => ({ bottom: a.bottom, top: a.top })),
      ]);
};

/**
 * Whether a block is set apart by edges, whatever the gap beside it: a box, a region, or a block
 * made only of such blocks, with no text of its own (a list of cards).
 */
const standsApart = (block: LaidBlock): boolean =>
  block.boxed ||
  block.region ||
  (block.children.length > 0 &&
    block.children.every(standsApart) &&
    block.lines.every((l) => block.children.some((c) => liesIn(l, c))));

/** A block whose parts sit one under another: a list or a group, whose line gaps mean something. */
const isColumn = (block: LaidBlock) => {
  const parts = [...block.children].sort((a, b) => a.top - b.top);
  return parts.every((part, i) => {
    const before = parts[i - 1];
    return before === undefined || part.top >= before.bottom - 1;
  });
};

/** Rows of a list are within this many pixels of one height. */
const ROW_TOLERANCE = 2;

/**
 * Whether a block holds rows: three or more of its parts of one height, stacked; a heading above
 * them is another height. Lines of a paragraph are not rows: rows are parts of their own.
 */
const holdsRows = (block: LaidBlock) => {
  const heights = block.children.map((c) => c.box.height);
  return (
    isColumn(block) &&
    heights.some(
      (h) =>
        heights.filter((other) => Math.abs(other - h) <= ROW_TOLERANCE)
          .length >= 3
    )
  );
};

/** A group of rows: a block holding rows, or one whose part does (a label over its list). */
const isRows = (block: LaidBlock) =>
  holdsRows(block) || block.children.some(holdsRows);

/**
 * The gap from a block's last line to the next block's first, a box's edge its line, when the two
 * are stacked.
 */
const gapBetween = (above: LaidBlock | undefined, below: LaidBlock) => {
  const last = above ? inkOf(above).at(-1) : undefined;
  const [first] = inkOf(below);
  // Side by side is a row, not a stack.
  return above && last && first && below.top >= above.bottom - 1
    ? first.top - last.bottom
    : undefined;
};

/**
 * Every pair of stacked blocks whose gap is less than the ratio times the gap between the lines
 * of the block below: `ratios.rows` when the block below is a group of rows, else `ratios.other`
 * (one number is both). A single line closer to the block below than to what is above it is that
 * block's heading (a label over its list, a title over its body), not a group of its own. A pair
 * where either block stands apart by its edges (`standsApart`) is not measured, and a box under
 * a block is one of its lines, edge to edge.
 */
export const spacingFindings = (
  block: LaidBlock,
  ratios: GroupRatios | number = GROUP_RATIOS
): readonly SpacingFinding[] => {
  const { other, rows } =
    typeof ratios === "number" ? { other: ratios, rows: ratios } : ratios;
  const found: SpacingFinding[] = [];
  const children = [...block.children].sort((a, b) => a.top - b.top);
  for (const [i, below] of children.entries()) {
    const above = children[i - 1];
    const between = gapBetween(above, below);
    // Lines from blocks side by side (a rail beside a panel) aren't one group's lines.
    const within = isColumn(below)
      ? median(gapsOf(inkOf(below)).filter((g) => g >= 0))
      : undefined;
    const before = above ? gapBetween(children[i - 2], above) : undefined;
    const heading =
      above?.lines.length === 1 &&
      between !== undefined &&
      (before === undefined || before > between);
    const ratio = isRows(below) ? rows : other;
    if (
      above &&
      !heading &&
      !standsApart(above) &&
      !standsApart(below) &&
      between !== undefined &&
      between >= 0 &&
      within !== undefined &&
      within > 0 &&
      between < ratio * within
    ) {
      found.push({
        above: above.label,
        aboveBox: above.box,
        below: below.label,
        belowBox: below.box,
        between: Math.round(between),
        ratio,
        within: Math.round(within),
      });
    }
  }
  return [...found, ...children.flatMap((c) => spacingFindings(c, ratios))];
};

/** Every rule whose centre is off its neighbours' line. */
export const dividerFindings = (
  rules: readonly LaidRule[]
): readonly DividerFinding[] =>
  rules
    .map((r) => ({
      bar: r.bar,
      box: r.box,
      off: Math.round((r.centre - r.sideCentre) * 10) / 10,
    }))
    .filter((r) => Math.abs(r.off) > DIVIDER_TOLERANCE);

/** A check's finding, and whether it shows at rest or only on hover. */
export type CheckFinding = AuditFinding & { readonly on: "hover" | "rest" };

/**
 * The findings at rest, then what only the hover pass found: its own findings not seen at rest,
 * and every control a person sees only on hover (hover-only actions, usability.md).
 */
export const hoverFindings = (audited: {
  readonly hover?: Audited;
  readonly rest: Audited;
}): readonly CheckFinding[] => {
  const rest = audited.rest.findings.map((f) => ({
    ...f,
    on: "rest" as const,
  }));
  const { hover } = audited;
  if (hover === undefined) {
    return rest;
  }
  const atRest = new Set(
    audited.rest.findings.map((f) => `${f.check}|${f.label}`)
  );
  const seen = new Set(audited.rest.controls);
  return [
    ...rest,
    ...hover.findings
      .filter((f) => !atRest.has(`${f.check}|${f.label}`))
      .map((f) => ({ ...f, on: "hover" as const })),
    ...hover.controls
      .filter((c) => !seen.has(c))
      .map((label) => ({
        box: hover.controlBoxes?.[label],
        check: "hover-only" as const,
        detail: "a control shown only under the pointer",
        label,
        on: "hover" as const,
        value: 1,
      })),
  ];
};
