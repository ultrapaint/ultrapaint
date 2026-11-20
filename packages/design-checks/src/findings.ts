/**
 * What the layout a page was read as (`layoutInBrowser`) and its audits say is wrong, as pure
 * functions of what was read:
 *
 * - **Groups apart:** the gap between two blocks stacked one above the other is at least `ratio`
 *   times the gap between the lines of the block below (the core's Spacing: "the gap between
 *   groups is at least 2× the gap within one, measured between the text"). Gaps are measured
 *   between lines of text, not boxes: a row's padding is space within it.
 * - **Dividers centred:** a thin vertical rule's centre is its neighbours' (the tools' line).
 * - **Hover:** what an audit found only with the controls drawn as hovered.
 * - **Border and shadow:** a box drawn with a hairline border (or a 1px ring) and a wide soft
 *   shadow of its own, two edges for one surface (g60; surfaces.md, "a line or a surface, never
 *   both"). Overlays are left out: a menu or a dialog floats over the page.
 */
import type {
  Audited,
  AuditFinding,
  Box,
  InkLine,
  LaidBlock,
  LaidRule,
  ShadowedBox,
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
  /** The median gap between the lines of the block below. */
  readonly within: number;
}

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
        aboveBox: above.box,
        below: below.label,
        belowBox: below.box,
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
      box: r.box,
      off: Math.round((r.centre - r.sideCentre) * 10) / 10,
    }))
    .filter((r) => Math.abs(r.off) > DIVIDER_TOLERANCE);

/** A layer of a computed `box-shadow`: its offsets, blur and spread in CSS pixels, its colour's alpha. */
export interface ShadowLayer {
  readonly alpha: number;
  readonly blur: number;
  readonly inset: boolean;
  readonly spread: number;
  readonly x: number;
  readonly y: number;
}

/** Splits at the commas outside parentheses: a shadow's layers, a colour function's arguments. */
const splitTop = (css: string, at: string) => {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const c of css) {
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    }
    if (c === at && depth === 0) {
      parts.push(part);
      part = "";
    } else {
      part += c;
    }
  }
  return [...parts, part].map((p) => p.trim()).filter((p) => p !== "");
};

/** A number, or a percentage as a fraction. */
const amount = (v: string) =>
  v.endsWith("%") ? Number.parseFloat(v) / 100 : Number.parseFloat(v);

/** A CSS colour's alpha, as a computed style writes it: `rgba(…, a)`, `oklch(… / a)`, `#rrggbbaa`. */
const alphaOf = (colour: string): number => {
  const c = colour.trim().toLowerCase();
  if (c === "transparent") {
    return 0;
  }
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    return hex.length === 4 || hex.length === 8
      ? Number.parseInt(
          hex.length === 4 ? hex.slice(3).repeat(2) : hex.slice(6),
          16
        ) / 255
      : 1;
  }
  const open = c.indexOf("(");
  if (open < 0 || !c.endsWith(")")) {
    return 1;
  }
  const inner = c.slice(open + 1, -1);
  const slash = splitTop(inner, "/");
  if (slash.length > 1) {
    return amount(slash.at(-1) ?? "1");
  }
  const args = splitTop(inner, ",");
  return args.length === 4 ? amount(args[3] ?? "1") : 1;
};

const LENGTH_RE = /^-?(\d+\.?\d*|\.\d+)(px)?$/;
const TOKEN_RE = /[a-z-]+\((?:[^()]|\([^()]*\))*\)|\S+/gi;

/** The layers of a computed `box-shadow`, `none` having none. */
export const shadowLayers = (css: string): readonly ShadowLayer[] =>
  css.trim() === "none"
    ? []
    : splitTop(css, ",").map((layer) => {
        const tokens = layer.match(TOKEN_RE) ?? [];
        const [x = 0, y = 0, blur = 0, spread = 0] = tokens
          .filter((t) => LENGTH_RE.test(t))
          .map(Number.parseFloat);
        const colour = tokens.find(
          (t) => t.toLowerCase() !== "inset" && !LENGTH_RE.test(t)
        );
        return {
          // A shadow with no colour is drawn in the text's colour: opaque, for this check.
          alpha: colour === undefined ? 1 : alphaOf(colour),
          blur,
          inset: tokens.some((t) => t.toLowerCase() === "inset"),
          spread,
          x,
          y,
        };
      });

/** A hairline: a 1px edge, from half a pixel to a pixel and a half. */
const hairline = (width: number) => width >= 0.5 && width <= 1.5;

/** A shadow this blurred or more is wide (g60). */
const WIDE_BLUR = 24;

/**
 * A shadow under this alpha is soft (g60): the counted pages' wide shadows were 0.18 to 0.45, a
 * negative spread keeping the darker ones soft.
 */
const SOFT_ALPHA = 0.5;

/**
 * Every box drawn with a hairline border on all four sides, or a 1px ring (a shadow with no blur
 * and a 1px spread), that also has a shadow of its own blurred 24px or more under 0.5 alpha: two
 * edges for one surface. A box that floats over the page (a menu, a popover, a dialog, a tooltip,
 * a toast) is left out, since its shadow lifts it.
 */
export const borderShadowFindings = (
  boxes: readonly ShadowedBox[]
): readonly AuditFinding[] =>
  boxes.flatMap((b) => {
    const layers = shadowLayers(b.shadow);
    const bordered = b.border.every(hairline);
    const ringed = layers.some(
      (l) =>
        l.alpha > 0 &&
        l.blur === 0 &&
        l.x === 0 &&
        l.y === 0 &&
        hairline(l.spread)
    );
    const wide = layers.find(
      (l) =>
        !l.inset && l.alpha > 0 && l.alpha < SOFT_ALPHA && l.blur >= WIDE_BLUR
    );
    if (b.overlay || !(wide && (bordered || ringed))) {
      return [];
    }
    return [
      {
        box: b.box,
        check: "border-shadow" as const,
        detail: `a 1px ${bordered ? "border" : "ring"} and a soft shadow (${wide.x}px ${wide.y}px ${wide.blur}px ${wide.spread}px at alpha ${Math.round(wide.alpha * 100) / 100}, blurred ${WIDE_BLUR}px or more under ${SOFT_ALPHA}): two edges for one surface`,
        label: b.label,
        value: wide.blur,
      },
    ];
  });

/** A check's finding, and whether it shows at rest or only on hover. */
export type CheckFinding = AuditFinding & { readonly on: "hover" | "rest" };

/**
 * The findings at rest (the border-and-shadow check's made from the boxes it read), then what only
 * the hover pass found: its own findings not seen at rest, and every control a person sees only on
 * hover (hover-only actions, usability.md).
 */
export const hoverFindings = (audited: {
  readonly hover?: Audited;
  readonly rest: Audited;
}): readonly CheckFinding[] => {
  const rest = [
    ...audited.rest.findings,
    ...borderShadowFindings(audited.rest.shadowed ?? []),
  ].map((f) => ({
    ...f,
    on: "rest" as const,
  }));
  const { hover } = audited;
  if (hover === undefined) {
    return rest;
  }
  const atRest = new Set(rest.map((f) => `${f.check}|${f.label}`));
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
