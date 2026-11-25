/**
 * A node's fields from an element's style (ADR 0148): its size and bounds, its spacing, fill,
 * border, corners, shadow and opacity, a stack's alignment and gap, and a text's settings, every
 * value written as the design system's token where it has one. What a field cannot hold is
 * counted in the warnings. Pure.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  Border,
  CrossAlign,
  MainAlign,
  Padding,
  Size,
  TextAlign,
} from "@ultrapaint/contracts/document";
import type { DeclaredValue } from "@ultrapaint/contracts/node-style";
import { spacingStepOf, tokenOf } from "@ultrapaint/contracts/token-table";
import { parseColor, toPx } from "@ultrapaint/contracts/token-value";
import { JUSTIFY } from "@ultrapaint/design-document/css";
import { isToken, tokenName } from "@ultrapaint/design-document/tokens";
import { type ElementStyle, isUnset } from "./element-style.ts";
import type { Values } from "./values.ts";
import type { Warn } from "./warnings.ts";

/** How a node's parent lays it out, which says what growing and stretching fill. */
export type Layout = "row" | "column" | "group";

const ITEMS: Readonly<Record<string, CrossAlign>> = {
  baseline: "baseline",
  center: "center",
  end: "end",
  "flex-end": "end",
  "flex-start": "start",
  start: "start",
  stretch: "stretch",
};
/** `justify-content` as a stack's alignment: the format's own words, `JUSTIFY` the other way. */
const ALIGN: Readonly<Record<string, MainAlign>> = {
  ...(Object.fromEntries(
    Object.entries(JUSTIFY).map(([k, v]) => [v, k])
  ) as Record<string, MainAlign>),
  end: "end",
  "space-evenly": "around",
  start: "start",
};
const TEXT_ALIGN: Readonly<Record<string, TextAlign>> = {
  center: "center",
  end: "end",
  left: "start",
  right: "end",
  start: "start",
};
const BORDER_STYLES: readonly NonNullable<Border["style"]>[] = [
  "solid",
  "dashed",
  "dotted",
];
const WEIGHTS: Readonly<Record<string, number>> = { bold: 700, normal: 400 };
const HUGS = new Set(["fit-content", "max-content", "min-content"]);
const URL_RE = /url\(/i;
const LAYER_SPLIT_RE = /,(?![^(]*\))/;
const NUMBER_RE = /^-?\d*\.?\d+$/;
/** A line height the format reads as a multiple of the size, as a number: one below 4. */
const MULTIPLE_BELOW = 4;
/** The largest radius, a full one: Tailwind's `rounded-full`, as the editor writes it. */
const FULL_RADIUS = 9999;

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;

/** A number written as a string, `"1.5"`, as a number; anything else as it is. */
const numeric = (value: DeclaredValue | undefined) =>
  typeof value === "string" && NUMBER_RE.test(value) ? Number(value) : value;

/**
 * A line height as the format holds it: pixels keep their unit, as a bare number below 4 is a
 * multiple of the size there; a multiple written as one (`"1.5"`) a number; a token as it is.
 */
const leadingOf = (value: DeclaredValue) => {
  if (typeof value === "number") {
    return `${value}px`;
  }
  // The format reads a number of 4 or more as pixels: a larger multiple stays as written.
  const multiple = numeric(value);
  return typeof multiple === "number" && multiple >= MULTIPLE_BELOW
    ? value
    : multiple;
};

/** The fields every node has, as a box's. */
export type BoxFields = ReturnType<ReturnType<typeof makeFields>["box"]>;

export const makeFields = (
  values: Values,
  designSystem: DesignSystem | null | undefined,
  warn: Warn
) => {
  /** A length in pixels, a token's own where it names one: `$spacing-4` on a 4px base is 16. */
  const pxOf = (value: DeclaredValue): number | null => {
    if (typeof value === "number") {
      return value;
    }
    if (!isToken(value)) {
      return toPx(value);
    }
    const name = tokenName(value);
    const step = spacingStepOf(name);
    if (step !== null) {
      return step * values.stepPx;
    }
    const css = tokenOf(designSystem, name)?.value;
    return css === undefined ? null : toPx(css);
  };

  /** One axis of a box: pixels, the room it fills, or its content's; else warned. */
  const sizeOf = (value: DeclaredValue | undefined): Size | undefined => {
    if (value === undefined || value === "auto") {
      return;
    }
    if (value === "100%") {
      return "fill";
    }
    if (HUGS.has(String(value))) {
      return "hug";
    }
    const px = pxOf(value);
    if (px === null) {
      warn("size");
      return;
    }
    return px;
  };

  const sizes = (style: ElementStyle, parent: Layout) => {
    let width = sizeOf(style.width);
    let height = sizeOf(style.height);
    // Growing into the free room is filling the parent's main axis; stretching, its cross axis,
    // only where that axis is left to it, its size `auto` and neither of its margins `auto`.
    const grows = style.flexGrow !== undefined && Number(style.flexGrow) > 0;
    const stretches = (
      size: Size | undefined,
      margins: readonly ("Top" | "Right" | "Bottom" | "Left")[]
    ) =>
      style.alignSelf === "stretch" &&
      size === undefined &&
      margins.every((side) => style[`margin${side}`] !== "auto");
    if (parent === "row") {
      width = grows ? "fill" : width;
      height = stretches(height, ["Top", "Bottom"]) ? "fill" : height;
    } else if (parent === "column") {
      height = grows ? "fill" : height;
      width = stretches(width, ["Left", "Right"]) ? "fill" : width;
    }
    return { height, width };
  };

  /** Padding or margin side by side, one value for all four where they agree. */
  const spacingSides = (
    style: ElementStyle,
    property: "padding" | "margin"
  ): Padding | undefined => {
    const [top, right, bottom, left] = ["Top", "Right", "Bottom", "Left"].map(
      (side) => {
        const value = style[`${property}${side}`];
        if (value === "auto" && property === "margin") {
          // A margin of `auto` centres the box, which the format keeps.
          return value;
        }
        return value === undefined || isUnset(value)
          ? undefined
          : values.spacing(value);
      }
    );
    if ([top, right, bottom, left].every((v) => v === undefined)) {
      return;
    }
    if (top !== undefined && [right, bottom, left].every((v) => v === top)) {
      return top;
    }
    return compact({ bottom, left, right, top });
  };

  /** A fill's colour as the design system's token, its gradients as written, its images out. */
  const fillOf = (style: ElementStyle): string | undefined => {
    if (style.background === undefined) {
      return;
    }
    let fill = String(style.background);
    if (URL_RE.test(fill)) {
      warn("backgroundImage");
      fill = fill
        .split(LAYER_SPLIT_RE)
        .map((layer) => layer.trim())
        .filter((layer) => !URL_RE.test(layer))
        .join(", ");
    }
    if (fill === "" || fill === "transparent") {
      return;
    }
    return parseColor(fill) === null && !isToken(fill)
      ? fill
      : String(values.of("color", fill));
  };

  const borderOf = (style: ElementStyle): Border | undefined => {
    const width = style.borderWidth;
    const line = String(style.borderStyle ?? "none");
    if (isUnset(width) || width === undefined || line === "none") {
      return;
    }
    const color = style.borderColor;
    return compact({
      color:
        color === undefined || color === "currentColor"
          ? undefined
          : String(values.of("color", color)),
      style: BORDER_STYLES.find((s) => s === line) ?? "solid",
      width: values.of("borderWidth", width),
    });
  };

  /** A corner's radius as a token of the design system's, a full one as it is. */
  const radiusOf = (radius: DeclaredValue | undefined) => {
    if (radius === undefined || isUnset(radius)) {
      return;
    }
    return radius === FULL_RADIUS ? radius : values.of("radius", radius);
  };

  /** The fields every node has: its size and bounds, spacing, fill, border, corners and shadow. */
  const box = (style: ElementStyle, parent: Layout) => {
    // A minimum of 0 binds nothing; a maximum of 0 holds the box shut.
    const bound = (value: DeclaredValue | undefined) =>
      isUnset(value) ? undefined : value;
    const maximum = (value: DeclaredValue | undefined) =>
      value === undefined || value === "none" ? undefined : value;
    const opacity = style.opacity === undefined ? 1 : Number(style.opacity);
    const shadow = style.boxShadow;
    return compact({
      ...sizes(style, parent),
      border: borderOf(style),
      fill: fillOf(style),
      margin: spacingSides(style, "margin"),
      maxHeight: maximum(style.maxHeight),
      maxWidth: maximum(style.maxWidth),
      minHeight: bound(style.minHeight),
      minWidth: bound(style.minWidth),
      opacity: opacity < 1 && opacity >= 0 ? opacity : undefined,
      padding: spacingSides(style, "padding"),
      radius: radiusOf(style.borderRadius),
      shadow:
        shadow === undefined || isUnset(shadow)
          ? undefined
          : String(values.of("shadow", shadow)),
    });
  };

  /** A stack's alignment on both axes, its gap along its axis and its wrap. */
  const stack = (style: ElementStyle, layout: "row" | "column") => {
    const gap = style[layout === "row" ? "columnGap" : "rowGap"];
    const wrap = style.flexWrap;
    return compact({
      align: ALIGN[String(style.justifyContent)],
      crossAlign: ITEMS[String(style.alignItems)],
      gap: gap === undefined || isUnset(gap) ? undefined : values.spacing(gap),
      wrap: wrap === "wrap" || wrap === "wrap-reverse" ? true : undefined,
    });
  };

  /** A weight as a token of the design system's, else a number: `bold` is 700. */
  const weightOf = (css: DeclaredValue | undefined) => {
    if (css === undefined || (typeof css === "string" && isToken(css))) {
      return css;
    }
    const text = String(css);
    const weight =
      WEIGHTS[text] ?? (NUMBER_RE.test(text) ? Number(text) : undefined);
    return weight === undefined
      ? undefined
      : numeric(values.of("fontWeight", String(weight)));
  };

  /** A text's settings, each its own or the one it inherits, as the design system's tokens. */
  const text = (settings: ElementStyle) => {
    const size =
      settings.fontSize === undefined
        ? undefined
        : values.of("fontSize", settings.fontSize);
    // A type size token brings the line height it is paired with.
    const paired =
      typeof size === "string" && isToken(size)
        ? `$${tokenName(size)}--line-height`
        : undefined;
    const { color, fontFamily, letterSpacing, lineHeight, textAlign } =
      settings;
    return compact({
      align:
        textAlign === undefined ? undefined : TEXT_ALIGN[String(textAlign)],
      color:
        color === undefined || color === "currentColor"
          ? undefined
          : String(values.of("color", color)),
      font:
        fontFamily === undefined
          ? undefined
          : String(values.of("font", fontFamily)),
      lineHeight:
        lineHeight === undefined ||
        lineHeight === "normal" ||
        lineHeight === paired
          ? undefined
          : leadingOf(values.of("leading", lineHeight)),
      size,
      tracking:
        letterSpacing === undefined || letterSpacing === "normal"
          ? undefined
          : values.of("tracking", letterSpacing),
      weight: weightOf(settings.fontWeight),
    });
  };

  return { box, stack, text };
};
