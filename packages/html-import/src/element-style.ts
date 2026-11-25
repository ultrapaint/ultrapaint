/**
 * An element's style, what an element of pasted markup sets with its classes and its inline
 * style, as one set of declarations (ADR 0148): the classes as the style system's class reader reads them, the inline
 * style over them field by field. Both come in many shapes, a shorthand or its longhands, a corner
 * or a side each; they are folded into one, so the rules that make fields read one property per
 * field (`padding*` side by side, `border*` and `borderRadius` once for every side, `background`
 * with its image). A length in pixels is a number. Pure, and reads the DOM it is given.
 */
import type {
  ClassReader,
  DeclaredValue,
} from "@ultrapaint/contracts/node-style";
import { parseLength } from "@ultrapaint/contracts/token-value";
import type { Warn, WarningKind } from "./warnings.ts";

/** An element's style: what its classes and inline style set, one property per field. */
export type ElementStyle = Partial<Record<string, DeclaredValue>>;

const KEBAB_RE = /-([a-z])/g;
const SPACES_RE = /\s+/;
const UNSET = new Set(["", "initial", "inherit", "unset", "revert"]);
const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const CORNERS = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const;
const BORDER_PARTS = ["Width", "Style", "Color"] as const;

const camel = (property: string) =>
  property.replace(KEBAB_RE, (_, c: string) => c.toUpperCase());

/** A value as the rules read it: pixels as a number, anything else as written. */
const pixelsOrCss = (value: DeclaredValue): DeclaredValue => {
  if (typeof value === "number") {
    return value;
  }
  const length = parseLength(value);
  return length?.unit === "px" ? length.value : value.trim();
};

/** One to four values of a box shorthand, side by side: `4px 8px` is 4, 8, 4, 8. */
const boxSides = (value: DeclaredValue): DeclaredValue[] => {
  const parts =
    typeof value === "number" ? [value] : value.trim().split(SPACES_RE);
  const [top = 0, right = top, bottom = top, left = right] =
    parts.map(pixelsOrCss);
  return [top, right, bottom, left];
};

/** The same value on every one of `names`, or undefined when they differ or one is not set. */
const allTheSame = (look: ElementStyle, names: readonly string[]) => {
  const [first, ...rest] = names.map((name) => look[name]);
  return first !== undefined && rest.every((v) => v === first)
    ? first
    : undefined;
};

/** Properties a fold reads and writes again as others, which the folded look leaves out. */
const FOLDED = new Set([
  "padding",
  "margin",
  "inset",
  "gap",
  "backgroundImage",
  "backgroundColor",
  ...BORDER_PARTS.flatMap((part) => SIDES.map((s) => `border${s}${part}`)),
  ...CORNERS.map((corner) => `border${corner}Radius`),
]);

/** A box shorthand's sides, each where the look does not set it on its own. */
const sidesOf = (look: ElementStyle): ElementStyle => {
  const out: ElementStyle = {};
  for (const box of ["padding", "margin", "inset"] as const) {
    const value = look[box];
    if (value !== undefined) {
      const sides = boxSides(value);
      SIDES.forEach((side, i) => {
        const name = box === "inset" ? side.toLowerCase() : `${box}${side}`;
        out[name] = look[name] ?? sides[i] ?? 0;
      });
    }
  }
  if (look.gap !== undefined) {
    const [row = 0, column = row] = boxSides(look.gap);
    out.rowGap = look.rowGap ?? row;
    out.columnGap = look.columnGap ?? column;
  }
  return out;
};

/** A border's and a corner's sides as one value where they agree; warned where they do not. */
const bordersOf = (look: ElementStyle, warn: Warn): ElementStyle => {
  const out: ElementStyle = {};
  const fold = (names: readonly string[], into: string, kind: WarningKind) => {
    if (names.every((name) => look[name] === undefined)) {
      return;
    }
    const same = allTheSame(look, names);
    if (same === undefined) {
      warn(kind);
    } else {
      out[into] = same;
    }
  };
  for (const part of BORDER_PARTS) {
    fold(
      SIDES.map((side) => `border${side}${part}`),
      `border${part}`,
      "borderSides"
    );
  }
  fold(
    CORNERS.map((corner) => `border${corner}Radius`),
    "borderRadius",
    "corners"
  );
  return out;
};

/** A fill's image over its colour, as one `background`. */
const backgroundOf = (look: ElementStyle): ElementStyle => {
  const layers = [look.backgroundImage, look.backgroundColor].filter(
    (v): v is DeclaredValue => v !== undefined && v !== "none"
  );
  return layers.length > 0 ? { background: layers.join(", ") } : {};
};

/**
 * Declarations folded so each field has one property: shorthands into sides, a border's and a
 * corner's sides into one where they agree, a gap into both axes, a fill's colour and image into
 * `background`. Sides that disagree are said in the warnings and left out.
 */
const folded = (declared: ElementStyle, warn: Warn): ElementStyle => {
  const look: ElementStyle = {};
  for (const [property, value] of Object.entries(declared)) {
    if (value !== undefined) {
      look[property] = pixelsOrCss(value);
    }
  }
  const kept = Object.fromEntries(
    Object.entries(look).filter(([property]) => !FOLDED.has(property))
  );
  return {
    ...kept,
    ...sidesOf(look),
    ...bordersOf(look, warn),
    ...backgroundOf(look),
  };
};

/** The longhands an element's inline style sets, as the DOM expands its shorthands. */
const inlineOf = (element: Element): ElementStyle => {
  const style = (element as HTMLElement).style as
    | CSSStyleDeclaration
    | undefined;
  const look: ElementStyle = {};
  for (let i = 0; i < (style?.length ?? 0); i += 1) {
    const property = style?.item(i) ?? "";
    const value = style?.getPropertyValue(property) ?? "";
    if (!(property.startsWith("--") || UNSET.has(value.trim()))) {
      look[camel(property)] = value;
    }
  }
  return look;
};

/**
 * What an element sets: its classes read by the style system's reader, the classes it could not
 * read said in the warnings, then its inline style over them, field by field.
 */
export const styleOf = (
  element: Element,
  classes: ClassReader,
  warn: Warn
): ElementStyle => {
  const list = [...element.classList];
  const reading = classes.read(list);
  warn("variant", reading.variants.length);
  warn("unread", reading.unread.length);
  return {
    ...folded(reading.declarations, warn),
    ...folded(inlineOf(element), warn),
  };
};

const FLEX = new Set(["flex", "inline-flex"]);
const GRID = new Set(["grid", "inline-grid"]);
/** Displays that put an inline element on a line of its own. */
const BLOCKS = new Set(["block", "flow-root", "table", ...FLEX, ...GRID]);

/** Whether it lays its children out as a flex. */
export const isFlex = (style: ElementStyle) => FLEX.has(String(style.display));

/** Whether it lays its children out as a grid. */
export const isGrid = (style: ElementStyle) => GRID.has(String(style.display));

/** Whether its display puts it on a line of its own, whatever its tag. */
export const isBlock = (style: ElementStyle) =>
  BLOCKS.has(String(style.display));

/** Whether it is positioned absolutely, out of the flow. */
export const isAbsolute = (style: ElementStyle) =>
  style.position === "absolute" || style.position === "fixed";

/** Whether a value sets nothing: none, `0`, `auto`. */
export const isUnset = (value: DeclaredValue | undefined) =>
  value === undefined ||
  value === 0 ||
  value === "0" ||
  value === "none" ||
  value === "auto";
