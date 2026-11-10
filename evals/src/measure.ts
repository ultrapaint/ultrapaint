/**
 * `measure`: the checks no wording made a reviewer see (g02, g08), measured on a rendered page
 * instead of looked for in a picture. Two, from the layout `layoutInBrowser` reads:
 *
 * - **Groups apart:** the gap between two blocks stacked one above the other is at least twice the
 *   gap between the lines of the block below (the core's Spacing: "the gap between groups is at
 *   least 2× the gap within one, measured between the text"). Gaps are measured between lines of
 *   text, not boxes: a row's padding is space within it.
 * - **Dividers centred:** a thin vertical rule's centre is its neighbours' (the tools' line).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Console, Effect } from "effect";
import { Browser } from "./browser.ts";
import { EvalsError } from "./errors.ts";
import type {
  Audited,
  AuditFinding,
  InkLine,
  LaidBlock,
  LaidRule,
} from "./in-page.ts";
import { writeJson } from "./layout.ts";

export interface SpacingFinding {
  readonly above: string;
  readonly below: string;
  /** From the last line of the block above to the first of the block below. */
  readonly between: number;
  /** The median gap between the lines of the block below. */
  readonly within: number;
}

export interface DividerFinding {
  readonly bar: string;
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

/** A block whose parts sit one under another: a list or a group, whose line gaps mean something. */
const isColumn = (block: LaidBlock) => {
  const parts = [...block.children].sort((a, b) => a.top - b.top);
  return parts.every((part, i) => {
    const before = parts[i - 1];
    return before === undefined || part.top >= before.bottom - 1;
  });
};

/** The gap from a block's last line to the next block's first, when the two are stacked. */
const gapBetween = (above: LaidBlock | undefined, below: LaidBlock) => {
  const last = above?.lines.at(-1);
  const [first] = below.lines;
  // Side by side is a row, not a stack.
  return above && last && first && below.top >= above.bottom - 1
    ? first.top - last.bottom
    : undefined;
};

/**
 * Every pair of stacked blocks whose gap is less than `ratio` times the gap between the lines of
 * the block below. A single line closer to the block below than to what is above it is that
 * block's heading (a label over its list, a title over its body), not a group of its own.
 */
export const spacingFindings = (
  block: LaidBlock,
  ratio = 2
): readonly SpacingFinding[] => {
  const found: SpacingFinding[] = [];
  const children = [...block.children].sort((a, b) => a.top - b.top);
  for (const [i, below] of children.entries()) {
    const above = children[i - 1];
    const between = gapBetween(above, below);
    // Lines from blocks side by side (a rail beside a panel) aren't one group's lines.
    const within = isColumn(below)
      ? median(gapsOf(below.lines).filter((g) => g >= 0))
      : undefined;
    const before = above ? gapBetween(children[i - 2], above) : undefined;
    const heading =
      above?.lines.length === 1 &&
      between !== undefined &&
      (before === undefined || before > between);
    if (
      above &&
      !heading &&
      between !== undefined &&
      between >= 0 &&
      within !== undefined &&
      within > 0 &&
      between < ratio * within
    ) {
      found.push({
        above: above.label,
        below: below.label,
        between: Math.round(between),
        within: Math.round(within),
      });
    }
  }
  return [...found, ...children.flatMap((c) => spacingFindings(c, ratio))];
};

/** Every rule whose centre is off its neighbours' line. */
export const dividerFindings = (
  rules: readonly LaidRule[]
): readonly DividerFinding[] =>
  rules
    .map((r) => ({
      bar: r.bar,
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
        check: "hover-only" as const,
        detail: "a control shown only under the pointer",
        label,
        on: "hover" as const,
        value: 1,
      })),
  ];
};

export interface MeasureOptions {
  /**
   * The general design checks too (contrast, control edges and fills, surface tones, touching
   * rows, clipped text, names that can't truncate, targets, controls shown only on hover); none
   * without it.
   */
  readonly checks?:
    | {
        /** The spacing scale's step for the computed-spacing check; 0 leaves it out. */
        readonly grid: number;
        /** Whether the page is checked again with every control drawn as hovered. */
        readonly hover: boolean;
        readonly nearTone: number;
        readonly stress: boolean;
      }
    | undefined;
  /** Where the findings go as JSON, besides the terminal. */
  readonly out: string | undefined;
  /** How many times the gap inside a group the gap between groups must be: the core's 2. */
  readonly ratio: number;
  /** What to measure: a CSS selector, the whole page by default. */
  readonly root: string;
  /** A module of steps to run first, `export default [async (page) => {}]`, as the capture scripts. */
  readonly steps: string | undefined;
  readonly theme: "dark" | "light";
}

export const measure = Effect.fn("measure")(function* (
  url: string,
  options: MeasureOptions
) {
  const browser = yield* Browser;
  const steps = options.steps
    ? yield* Effect.tryPromise({
        catch: (cause) =>
          new EvalsError({
            message: `cannot load the steps ${options.steps}: ${String(cause)}`,
          }),
        try: () =>
          import(pathToFileURL(path.resolve(options.steps ?? "")).href),
      }).pipe(
        Effect.map((module: { readonly default?: unknown }) => module.default)
      )
    : undefined;
  const layout = yield* browser.layout(url, {
    root: options.root,
    steps: Array.isArray(steps) ? steps : [],
    theme: options.theme,
  });
  const spacing = layout.block
    ? spacingFindings(layout.block, options.ratio)
    : [];
  const dividers = dividerFindings(layout.rules);
  for (const f of spacing) {
    yield* Console.log(
      `groups: ${f.between}px between “${f.above}” and “${f.below}”, ${f.within}px between the lines below: under ${options.ratio}×`
    );
  }
  for (const f of dividers) {
    yield* Console.log(`divider: ${f.off}px off its bar's line, in “${f.bar}”`);
  }
  const audited = options.checks
    ? yield* browser.audit(url, {
        ...options.checks,
        hoverChecks: ["touching-rows", "control-fill"],
        root: options.root,
        steps: Array.isArray(steps) ? steps : [],
        theme: options.theme,
      })
    : undefined;
  const checked = audited ? hoverFindings(audited) : [];
  for (const f of checked) {
    yield* Console.log(
      `${f.check}${f.on === "hover" ? " (on hover)" : ""}: ${f.detail}, “${f.label}”`
    );
  }
  yield* Console.log(
    `${spacing.length} spacing and ${dividers.length} divider findings; ${layout.rules.length} dividers measured${options.checks ? `; ${checked.length} from the checks` : ""}`
  );
  if (options.out) {
    yield* writeJson(options.out, {
      checks: checked,
      dividers,
      spacing,
      theme: options.theme,
      url,
    });
  }
});
