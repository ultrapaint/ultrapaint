/**
 * Padding and margin side by side: one value for every side, or one per side. The toolbar and
 * the inspector read them through these, and write them back in the shortest form.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { Length, Padding, Sides } from "@ultrapaint/contracts/document";

export type Side = keyof Sides;

/** In CSS order, which is the order the fields and the labels follow. */
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** Every side of a padding or margin, each set or not. */
export const sidesOf = (value: Padding | undefined): Sides => {
  if (value === undefined) {
    return {};
  }
  return typeof value === "object"
    ? value
    : { bottom: value, left: value, right: value, top: value };
};

/** The value for these sides: none, one value when all four agree, else the sides. */
export const spacingOf = (sides: Sides): JsonValue => {
  const set = SIDES.filter((s) => sides[s] !== undefined);
  if (set.length === 0) {
    return null;
  }
  const [first] = SIDES.map((s) => sides[s]);
  if (SIDES.every((s) => sides[s] === first) && first !== undefined) {
    return first;
  }
  return Object.fromEntries(set.map((s) => [s, sides[s] as Length]));
};

/** The value with these sides set to `to`; `null` takes them off. */
export const withSides = (
  value: Padding | undefined,
  sides: readonly Side[],
  to: JsonValue
): JsonValue => {
  const next: Record<string, Length | undefined> = { ...sidesOf(value) };
  for (const side of sides) {
    next[side] =
      to === null || (typeof to !== "number" && typeof to !== "string")
        ? undefined
        : to;
  }
  return spacingOf(next);
};

/**
 * What these sides hold across these values: the one value they share, `undefined` when none of
 * them is set, or `mixed` when they differ.
 */
export const sharedSide = (
  values: readonly (Padding | undefined)[],
  sides: readonly Side[]
): { mixed: boolean; value: Length | undefined } => {
  const all = values.flatMap((v) => sides.map((s) => sidesOf(v)[s]));
  const [first] = all;
  return all.every((v) => v === first)
    ? { mixed: false, value: first }
    : { mixed: true, value: undefined };
};

/** Whether the two sides of an axis differ, which two fields cannot show. */
export const axesSplit = (value: Padding | undefined): boolean => {
  const s = sidesOf(value);
  return s.left !== s.right || s.top !== s.bottom;
};

/**
 * How the toolbar reads a padding: `12` for every side, `12, 6` for horizontal then vertical, as
 * the fields are laid out, else the four sides in CSS order. An unset side is `0`.
 */
export const sidesLabel = (
  value: Padding | undefined,
  show: (v: Length) => string
): string => {
  const s = sidesOf(value);
  const [top, right, bottom, left] = SIDES.map((k) => {
    const v = s[k];
    return v === undefined ? "0" : show(v);
  });
  if (top === right && top === bottom && top === left) {
    return top ?? "0";
  }
  if (left === right && top === bottom) {
    return `${left}, ${top}`;
  }
  return [top, right, bottom, left].join(", ");
};
