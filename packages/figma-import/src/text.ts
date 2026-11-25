/**
 * A text layer as a text node: its characters, the font it is set in, whether it reads as a
 * heading, its case and the lines it is cut to.
 */
import type { DesignNode, Length } from "@ultrapaint/contracts/document";
import { type IdGenerator, idPrefix } from "@ultrapaint/design-document/ids";
import type { FigNode } from "openfig-core";
import { boxOf, type Placement, round } from "./layout.ts";
import { solidColor, type TokenMatcher } from "./paint.ts";

const WEIGHTS: readonly (readonly [string, number])[] = [
  ["extralight", 200],
  ["ultralight", 200],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["semibold", 600],
  ["demibold", 600],
  ["thin", 100],
  ["light", 300],
  ["medium", 500],
  ["bold", 700],
  ["black", 900],
  ["heavy", 900],
];

const SPACES_RE = /\s+/g;
const NEWLINE_RE = /\r?\n/;
const HEADING_MAX_LENGTH = 120;

/** `Semi Bold Italic` → 600; a style that names no weight is regular. */
export const weightOf = (style: string | undefined): number | undefined => {
  const flat = (style ?? "").toLowerCase().replace(SPACES_RE, "");
  return WEIGHTS.find(([word]) => flat.includes(word))?.[1];
};

/** A short single line set large or heavy reads as a heading. */
const headingLevel = (
  text: string,
  size: number | undefined,
  weight: number | undefined
): number | null => {
  if (
    size === undefined ||
    NEWLINE_RE.test(text) ||
    text.length > HEADING_MAX_LENGTH
  ) {
    return null;
  }
  if (size >= 40) {
    return 1;
  }
  if (size >= 32) {
    return 2;
  }
  if (size >= 24) {
    return 3;
  }
  return size >= 20 && (weight ?? 400) >= 600 ? 4 : null;
};

const textAlign = (value: string | undefined) => {
  switch (value) {
    case "CENTER":
      return "center" as const;
    case "RIGHT":
      return "end" as const;
    default:
      return;
  }
};

interface Measure {
  readonly units?: string;
  readonly value?: number;
}

/** A line height in pixels or percent; Figma's "auto" is left to the design system. */
const lineHeightOf = (measure: Measure | undefined): Length | undefined => {
  if (measure?.value === undefined || measure.units === "RAW") {
    return undefined;
  }
  return measure.units === "PERCENT"
    ? `${round(measure.value)}%`
    : round(measure.value);
};

/** Figma's cases the format has no value for, by what a warning calls them. */
const CASES_LEFT_OUT: Readonly<Record<string, string>> = {
  SMALL_CAPS: "small caps",
  SMALL_CAPS_FORCED: "small caps",
  TITLE: "title case",
};

/** Upper or lower case; title case and small caps have no value, and are said (ADR 0016). */
const caseOf = (node: FigNode, warn: (text: string) => void) => {
  switch (node.textCase) {
    case "UPPER":
      return "upper" as const;
    case "LOWER":
      return "lower" as const;
    default: {
      const left = CASES_LEFT_OUT[String(node.textCase)];
      if (left !== undefined) {
        warn(`"${node.name}" is set in ${left}, which was left out`);
      }
      return;
    }
  }
};

/**
 * How tall one line is, in pixels: a multiple of the size (`RAW`), a percent of it, or pixels;
 * Figma's "auto" as CSS's `normal`, about 1.2 of the size.
 */
const linePixels = (measure: Measure | undefined, size: number): number => {
  const value = measure?.value;
  if (value === undefined || value <= 0) {
    return size * 1.2;
  }
  if (measure?.units === "RAW") {
    return value * size;
  }
  return measure?.units === "PERCENT" ? (value / 100) * size : value;
};

/**
 * The lines a text truncated at its end is cut to: its maximum, or with none the lines its box's
 * height holds, at least one, which is said: a text cut with no maximum is cut at its box's
 * height (ADR 0016). A text not truncated takes every line.
 */
const linesOf = (
  node: FigNode,
  warn: (text: string) => void
): number | undefined => {
  if (node.textTruncation !== "ENDING") {
    return;
  }
  const max = Number(node.maxLines);
  if (Number.isInteger(max) && max >= 1) {
    return max;
  }
  const line = linePixels(
    node.lineHeight as Measure | undefined,
    node.fontSize ?? 16
  );
  const held = Math.max(1, Math.floor((node.size?.y ?? 0) / line));
  warn(
    `"${node.name}" is cut at its end with no maximum of lines: it takes the ${held} its height holds`
  );
  return held;
};

const trackingOf = (measure: Measure | undefined): Length | undefined => {
  if (measure?.value === undefined || measure.value === 0) {
    return undefined;
  }
  return measure.units === "PERCENT"
    ? `${round(measure.value / 100)}em`
    : round(measure.value);
};

/** Fixed on the axes Figma fixes: a text that grows both ways hugs. */
const ownSize = (node: FigNode) => {
  const auto = node.textAutoResize;
  return {
    height: auto === "NONE" && node.size ? round(node.size.y) : undefined,
    width:
      (auto === "NONE" || auto === "HEIGHT") && node.size
        ? round(node.size.x)
        : undefined,
  };
};

export const textNode = (
  node: FigNode,
  placement: Placement,
  {
    next,
    tokens,
    warn,
  }: {
    readonly next: IdGenerator;
    readonly tokens: TokenMatcher;
    readonly warn: (text: string) => void;
  }
): DesignNode | null => {
  const characters = String(node.textData?.characters ?? "");
  if (characters.trim() === "") {
    return null;
  }
  const styles = (node.textData as { styleOverrideTable?: unknown[] })
    .styleOverrideTable;
  if (styles && styles.length > 0) {
    warn(`"${node.name}" mixes text styles; it is set in one`);
  }
  const size = node.fontSize === undefined ? undefined : round(node.fontSize);
  const weight = weightOf(node.fontName?.style);
  const level = headingLevel(characters, size, weight);
  const color = solidColor(node.fillPaints);
  const fields = {
    ...boxOf(node, placement, ownSize(node), tokens),
    align: textAlign(node.textAlignHorizontal),
    case: caseOf(node, warn),
    color: color === undefined ? undefined : tokens(color),
    fill: undefined,
    font: node.fontName?.family,
    id: next(idPrefix("text")),
    level: level ?? undefined,
    lineHeight: lineHeightOf(node.lineHeight as Measure | undefined),
    lines: linesOf(node, warn),
    role: level === null ? ("paragraph" as const) : ("heading" as const),
    size,
    text: characters,
    tracking: trackingOf(node.letterSpacing as Measure | undefined),
    type: "text" as const,
    weight,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as unknown as DesignNode;
};
