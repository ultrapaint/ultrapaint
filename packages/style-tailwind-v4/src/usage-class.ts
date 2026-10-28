/**
 * A Tailwind class taken apart the way the usage scan reads it: its variants, importance and
 * sign (`utilities`' grammar), the utility the scan reads, its value and a colour's opacity.
 */

import { COLOR_SET, UTILITIES } from "./usage-vocabulary.ts";
import {
  parseClass,
  splitModifier,
  type TailwindClass,
  utilityReader,
} from "./utilities.ts";

/** A class taken apart: what is around the utility, the utility, and its value. */
export interface ClassParts extends TailwindClass {
  /** A colour's opacity, `/50`, kept when the value changes. */
  readonly modifier: string;
  readonly use: string;
  /** Empty for `rounded` and `shadow` alone. */
  readonly value: string;
}

const readUtility = utilityReader(UTILITIES);

/** A class taken apart; null for anything this does not look at. */
export const splitClass = (candidate: string): ClassParts | null => {
  const parts = parseClass(candidate);
  const read = readUtility(parts.utility);
  if (read === null) {
    return null;
  }
  const { use, value } = read;
  if (value === undefined) {
    return use === "rounded" || use === "shadow"
      ? { ...parts, modifier: "", use, value: "" }
      : null;
  }
  // `/50` is a colour's opacity; on `left-1/2` it is the value.
  const own = COLOR_SET.has(use)
    ? splitModifier(value)
    : { modifier: "", value };
  return own.value ? { ...parts, ...own, use } : null;
};

/** A class, read as a utility and its value; null for anything this does not look at. */
export const readClass = (
  candidate: string
): { readonly use: string; readonly value: string } | null => {
  const parts = splitClass(candidate);
  return parts ? { use: parts.use, value: parts.value } : null;
};
