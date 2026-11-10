/**
 * Values a design sets for itself where the design system has a token: the general check the
 * shift-left proposal runs at each edit (ADR 0061), on the document rather than the rendered page,
 * where a value's origin is still known. A number is pixels, `$name` a token, anything else CSS
 * (`@ultrapaint/contracts/node-style`); a raw value of a kind the system tokenises is off it.
 *
 * Spacing in pixels is on the system when it is a step of the spacing scale as the token table
 * has it (`spacingStepAt`: 16 is four steps of 4, 10 two and a half), which is what the editor
 * writes as that step. Any other raw spacing, and any raw colour, radius, shadow or type value,
 * is off it.
 *
 * Left alone: 0 and the CSS keywords that are no value (`none`, `transparent`, `auto`,
 * `currentColor`, `inherit`); sizes (a width, a height), which are the layout's; a round radius
 * given as a percentage; and an instance's props, which are its component's.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { spacingStepAt } from "@ultrapaint/contracts/token-table";
import { isToken } from "./tokens.ts";
import { childrenOf } from "./tree.ts";

/** The spacing base in pixels when the design system says none: Tailwind's 0.25rem. */
const DEFAULT_SPACING_BASE = 4;

/** What kind of token a value should have been. */
export type OffSystemKind =
  | "spacing"
  | "radius"
  | "color"
  | "shadow"
  | "font"
  | "text-size"
  | "weight"
  | "line-height"
  | "tracking";

export interface OffSystemValue {
  /** The field, with its side or breakpoint: `padding.top`, `at.md.gap`, `border.color`. */
  readonly field: string;
  readonly kind: OffSystemKind;
  /** The node's name, else its id. */
  readonly node: string;
  readonly value: string | number;
}

const NO_VALUE = new Set([
  "none",
  "transparent",
  "auto",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
]);

/** Whether a value is the design's own where a token was due. */
export const isOffSystem = (
  kind: OffSystemKind,
  value: unknown,
  spacingBase = DEFAULT_SPACING_BASE
): boolean => {
  if (value === undefined || value === null || isToken(value)) {
    return false;
  }
  if (typeof value === "number") {
    return kind === "spacing"
      ? spacingStepAt(value, spacingBase) === null
      : value !== 0;
  }
  if (typeof value !== "string") {
    return false;
  }
  const v = value.trim().toLowerCase();
  if (v === "" || v === "0" || NO_VALUE.has(v)) {
    return false;
  }
  // A circle's radius: no token stands for it.
  return !(kind === "radius" && v.endsWith("%"));
};

/** The fields of a node a token is due for, with what kind of token. */
const FIELDS: readonly (readonly [string, OffSystemKind])[] = [
  ["gap", "spacing"],
  ["radius", "radius"],
  ["fill", "color"],
  ["color", "color"],
  ["shadow", "shadow"],
  ["font", "font"],
  ["size", "text-size"],
  ["weight", "weight"],
  ["lineHeight", "line-height"],
  ["tracking", "tracking"],
];

/** One node's fields (its own, or a breakpoint's), each value a token was due for and isn't. */
const offIn = (
  fields: Readonly<Record<string, unknown>>,
  prefix: string,
  node: string,
  spacingBase: number
): OffSystemValue[] => {
  const found: OffSystemValue[] = [];
  const check = (field: string, kind: OffSystemKind, value: unknown) => {
    if (isOffSystem(kind, value, spacingBase)) {
      found.push({
        field: `${prefix}${field}`,
        kind,
        node,
        value: value as string | number,
      });
    }
  };
  for (const [field, kind] of FIELDS) {
    // A text node's size is its font size; a box's width and height are not checked.
    if (field !== "size" || fields.type === "text" || prefix !== "") {
      check(field, kind, fields[field]);
    }
  }
  for (const box of ["padding", "margin"] as const) {
    const value = fields[box];
    if (typeof value === "object" && value !== null) {
      for (const [side, v] of Object.entries(value)) {
        check(`${box}.${side}`, "spacing", v);
      }
    } else {
      check(box, "spacing", value);
    }
  }
  const { border } = fields;
  if (typeof border === "object" && border !== null) {
    check("border.color", "color", (border as { color?: unknown }).color);
  }
  return found;
};

/** Every value in a page's tree that is the design's own where the design system has a token. */
export const offSystemValues = (
  root: DesignNode,
  spacingBase = DEFAULT_SPACING_BASE
): readonly OffSystemValue[] => {
  const found: OffSystemValue[] = [];
  const visit = (node: DesignNode) => {
    const name = node.name ?? node.id;
    if (node.type !== "instance") {
      const fields = node as unknown as Readonly<Record<string, unknown>>;
      found.push(...offIn(fields, "", name, spacingBase));
      const { at } = fields;
      if (typeof at === "object" && at !== null) {
        for (const [breakpoint, over] of Object.entries(at)) {
          found.push(
            ...offIn(
              { ...(over as Record<string, unknown>), type: node.type },
              `at.${breakpoint}.`,
              name,
              spacingBase
            )
          );
        }
      }
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return found;
};
