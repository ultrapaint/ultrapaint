/**
 * An element's style, what an element of pasted markup sets with its classes and its inline
 * style, as one set of declarations (ADR 0148): the classes as the style system's class reader reads them, the inline
 * style over them field by field. Both come in many shapes, a shorthand or its longhands, a corner
 * or a side each: both are taken apart into the same components, met, then folded into one, so
 * the rules that make fields read one property per field (`padding*` side by side, `border*` and
 * `borderRadius` once for every side, `background` with its image). A length in pixels is a
 * number. Pure, and reads the DOM it is given.
 */
import type {
  ClassReader,
  DeclaredValue,
} from "@ultrapaint/contracts/node-style";
import { parseColor, parseLength } from "@ultrapaint/contracts/token-value";
import { isToken } from "@ultrapaint/design-document/tokens";
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

const BOXES = new Set(["padding", "margin", "inset"]);
const BORDER_WHOLE = new Set(BORDER_PARTS.map((part) => `border${part}`));
const LAYER_SPLIT_RE = /,(?![^(]*\))/;

/** A box shorthand's property for one side: `paddingTop`, but `top` for the inset. */
const sideName = (box: string, side: (typeof SIDES)[number]) =>
  box === "inset" ? side.toLowerCase() : `${box}${side}`;

/** A fill as its image over its colour: the colour is its last layer, when that is one. */
const backgroundParts = (value: DeclaredValue): ElementStyle => {
  const layers = String(value)
    .split(LAYER_SPLIT_RE)
    .map((layer) => layer.trim());
  const last = layers.at(-1) ?? "";
  const colour =
    parseColor(last) !== null || isToken(last) || last === "transparent";
  const images = colour ? layers.slice(0, -1) : layers;
  return {
    ...(colour ? { backgroundColor: last } : {}),
    ...(images.length > 0 ? { backgroundImage: images.join(", ") } : {}),
  };
};

/** One declaration as the components the classes' and the inline style's meet in. */
const components = (property: string, value: DeclaredValue): ElementStyle => {
  if (BOXES.has(property)) {
    const sides = boxSides(value);
    return Object.fromEntries(
      SIDES.map((side, i) => [sideName(property, side), sides[i] ?? 0])
    );
  }
  if (property === "gap") {
    const [row = 0, column = row] = boxSides(value);
    return { columnGap: column, rowGap: row };
  }
  if (BORDER_WHOLE.has(property)) {
    const part = property.slice("border".length);
    return Object.fromEntries(
      SIDES.map((side) => [`border${side}${part}`, value])
    );
  }
  if (property === "borderRadius") {
    return Object.fromEntries(
      CORNERS.map((corner) => [`border${corner}Radius`, value])
    );
  }
  if (property === "background") {
    return backgroundParts(value);
  }
  return { [property]: value };
};

/**
 * Declarations as components, so the classes' and the inline style's meet field by field: a box
 * shorthand as its sides, a gap as its two axes, a whole border and radius as each side's and
 * corner's, a fill as its image and its colour. Pixels are a number.
 */
const expanded = (declared: ElementStyle): ElementStyle => {
  const out: ElementStyle = {};
  for (const [property, value] of Object.entries(declared)) {
    if (value !== undefined) {
      Object.assign(out, components(property, pixelsOrCss(value)));
    }
  }
  return out;
};

/** The components a fold writes again as one property, which the folded style leaves out. */
const FOLDED = new Set([
  "backgroundImage",
  "backgroundColor",
  ...BORDER_PARTS.flatMap((part) => SIDES.map((s) => `border${s}${part}`)),
  ...CORNERS.map((corner) => `border${corner}Radius`),
]);

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
 * Components folded so each field the rules read has one property: a border's and a corner's sides
 * into one where they agree (warned where they do not), a fill's image and colour into
 * `background`. Padding, margin and the inset stay side by side.
 */
const folded = (look: ElementStyle, warn: Warn): ElementStyle => ({
  ...Object.fromEntries(
    Object.entries(look).filter(([property]) => !FOLDED.has(property))
  ),
  ...bordersOf(look, warn),
  ...backgroundOf(look),
});

/** An element's inline style: the longhands the DOM expands it into, and those it resets. */
const inlineOf = (
  element: Element
): { readonly reset: ReadonlySet<string>; readonly set: ElementStyle } => {
  const style = (element as HTMLElement).style as
    | CSSStyleDeclaration
    | undefined;
  const set: ElementStyle = {};
  const reset = new Set<string>();
  for (let i = 0; i < (style?.length ?? 0); i += 1) {
    const property = style?.item(i) ?? "";
    const value = (style?.getPropertyValue(property) ?? "").trim();
    if (property.startsWith("--")) {
      continue;
    }
    if (UNSET.has(value)) {
      // `initial` and its like take back what a class set.
      for (const name of Object.keys(components(camel(property), 0))) {
        reset.add(name);
      }
    } else {
      set[camel(property)] = value;
    }
  }
  return { reset, set };
};

/**
 * What an element sets: its classes read by the style system's reader, the classes it could not
 * read said in the warnings, then its inline style over them, component by component, a reset
 * (`initial`) taking a class's value back.
 */
export const styleOf = (
  element: Element,
  classes: ClassReader,
  warn: Warn
): ElementStyle => {
  const reading = classes.read([...element.classList]);
  warn("variant", reading.variants.length);
  warn("unread", reading.unread.length);
  const inline = inlineOf(element);
  const merged = Object.fromEntries(
    Object.entries({
      ...expanded(reading.declarations),
      ...expanded(inline.set),
    }).filter(([name]) => !inline.reset.has(name))
  );
  return folded(merged, warn);
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
