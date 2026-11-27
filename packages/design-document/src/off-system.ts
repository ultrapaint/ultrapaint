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
 * A fill in layers (ADR 0134) is on the system when each of its colours is: a gradient whose
 * every stop is a token, or a keyword that is no value, passes; a raw stop or a raw colour layer
 * is off it, and is reported alone, not the fill it is in. A shadow list is read shadow by
 * shadow: a raw shadow anywhere in it is off it, and is reported alone.
 *
 * Left alone: 0 and the CSS keywords that are no value (`none`, `transparent`, `auto`,
 * `currentColor`, `inherit`); sizes (a width, a height), which are the layout's; a round radius
 * given as a percentage; and an instance's props, which are its component's.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { spacingStepAt } from "@ultrapaint/contracts/token-table";
import { fillLayers } from "./fill.ts";
import { shadowsOf } from "./shadow.ts";
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
  /**
   * The node's fields of this kind, with its breakpoints', as one string, their values on the
   * system or off: what a decline of the value holds to while it reads the same (ADR 0156).
   */
  readonly fields: string;
  /** The node's id. */
  readonly id: string;
  readonly kind: OffSystemKind;
  /**
   * The fill layer the value is (ADR 0134): one of a gradient's stops, or a colour layer among
   * others. None for a value that is the whole field.
   */
  readonly layer?: "gradient" | "colour" | undefined;
  /** The node's name, else its id. */
  readonly node: string;
  /** The raw value itself: in a fill of several layers, the stop or colour layer, not the fill. */
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
  // A shadow list is read shadow by shadow, a token first in it hiding no raw one after.
  const shadows = kind === "shadow" ? shadowsOf(String(value ?? "")) : [];
  if (shadows.length > 1) {
    return shadows.some((shadow) => isOffSystem(kind, shadow));
  }
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
  if (kind === "color") {
    const layers = fillLayers(value);
    const read = layers.every((l) => l.kind !== "css");
    // An image is no colour: only its colour layers are checked (ADR 0149).
    if (read && (layers.length > 1 || layers[0]?.kind !== "color")) {
      return layers.some((layer) =>
        layer.kind === "gradient"
          ? layer.stops.some((stop) => isOffSystem(kind, stop.color))
          : layer.kind === "color" && isOffSystem(kind, layer.color)
      );
    }
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

/** A field of a node a token is due for, as the check names it, and what it holds. */
export interface TokenField {
  /** The field, with its side or breakpoint: `padding.top`, `at.md.gap`, `border.color`. */
  readonly field: string;
  readonly kind: OffSystemKind;
  readonly value: unknown;
}

/**
 * One node's fields (its own, or a breakpoint's, `prefix` naming it) a token is due for, in the
 * check's order and by its paths: what the off-system check reads, and what finding a value
 * across a canvas walks.
 */
export const tokenFieldsOf = (
  fields: Readonly<Record<string, unknown>>,
  prefix: string
): TokenField[] => {
  const found: TokenField[] = [];
  for (const [field, kind] of FIELDS) {
    // A text node's size is its font size; a box's width and height are not checked.
    if (field !== "size" || fields.type === "text" || prefix !== "") {
      found.push({ field: `${prefix}${field}`, kind, value: fields[field] });
    }
  }
  for (const box of ["padding", "margin"] as const) {
    const value = fields[box];
    if (typeof value === "object" && value !== null) {
      for (const [side, v] of Object.entries(value)) {
        found.push({
          field: `${prefix}${box}.${side}`,
          kind: "spacing",
          value: v,
        });
      }
    } else {
      found.push({ field: `${prefix}${box}`, kind: "spacing", value });
    }
  }
  const { border } = fields;
  if (typeof border === "object" && border !== null) {
    found.push({
      field: `${prefix}border.color`,
      kind: "color",
      value: (border as { color?: unknown }).color,
    });
  }
  return found;
};

/** A raw colour of a fill, and the fill layer it is in. */
interface RawLayer {
  readonly color: string;
  readonly layer: NonNullable<OffSystemValue["layer"]>;
}

/**
 * A fill's colours off the system, layer by layer (ADR 0134): a gradient's stops, and its colour
 * layers when it has more than one layer (an image is no colour, ADR 0149). None for a fill of
 * one colour layer, or one the editor cannot read: the raw value is the whole field.
 */
const rawLayersOf = (
  kind: OffSystemKind,
  value: unknown
): readonly RawLayer[] | undefined => {
  if (kind !== "color" || typeof value !== "string" || isToken(value)) {
    return undefined;
  }
  const layers = fillLayers(value);
  if (
    !layers.every((l) => l.kind !== "css") ||
    (layers.length === 1 && layers[0]?.kind === "color")
  ) {
    return undefined;
  }
  return layers.flatMap<RawLayer>((layer) => {
    if (layer.kind === "gradient") {
      return layer.stops
        .filter((stop) => isOffSystem(kind, stop.color))
        .map((stop) => ({ color: stop.color, layer: "gradient" }));
    }
    return layer.kind === "color" && isOffSystem(kind, layer.color)
      ? [{ color: layer.color, layer: "colour" }]
      : [];
  });
};

/** The node a value is on: its id, its name, and its fields of each kind as one string. */
interface ValueNode {
  readonly fieldsOf: (kind: OffSystemKind) => string;
  readonly id: string;
  readonly name: string;
}

/** One node's fields (its own, or a breakpoint's), each value a token was due for and isn't. */
const offIn = (
  fields: Readonly<Record<string, unknown>>,
  prefix: string,
  owner: ValueNode,
  spacingBase: number
): OffSystemValue[] => {
  const { fieldsOf, id, name: node } = owner;
  const found: OffSystemValue[] = [];
  const check = (field: string, kind: OffSystemKind, value: unknown) => {
    // A shadow list is reported shadow by shadow: the raw one, not the list it is in.
    const shadows = kind === "shadow" ? shadowsOf(String(value ?? "")) : [];
    if (shadows.length > 1) {
      for (const shadow of shadows) {
        check(field, kind, shadow);
      }
      return;
    }
    // A fill of layers is reported by its raw stops and colour layers, each once (ADR 0134).
    const layers = rawLayersOf(kind, value);
    if (layers !== undefined) {
      for (const { color, layer } of layers) {
        if (!found.some((f) => f.field === field && f.value === color)) {
          found.push({
            field,
            fields: fieldsOf(kind),
            id,
            kind,
            layer,
            node,
            value: color,
          });
        }
      }
      return;
    }
    if (isOffSystem(kind, value, spacingBase)) {
      found.push({
        field,
        fields: fieldsOf(kind),
        id,
        kind,
        node,
        value: value as string | number,
      });
    }
  };
  for (const { field, kind, value } of tokenFieldsOf(fields, prefix)) {
    check(field, kind, value);
  }
  return found;
};

/** A node's own fields, and each breakpoint's with the node's type, as the check reads them. */
const fieldSetsOf = (node: DesignNode) => {
  const fields = node as unknown as Readonly<Record<string, unknown>>;
  const sets: (readonly [Readonly<Record<string, unknown>>, string])[] = [
    [fields, ""],
  ];
  const { at } = fields;
  if (typeof at === "object" && at !== null) {
    for (const [breakpoint, over] of Object.entries(at)) {
      sets.push([
        { ...(over as Record<string, unknown>), type: node.type },
        `at.${breakpoint}.`,
      ]);
    }
  }
  return sets;
};

/** Every value in a page's tree that is the design's own where the design system has a token. */
export const offSystemValues = (
  root: DesignNode,
  spacingBase = DEFAULT_SPACING_BASE
): readonly OffSystemValue[] => {
  const found: OffSystemValue[] = [];
  const visit = (node: DesignNode) => {
    if (node.type !== "instance") {
      const sets = fieldSetsOf(node);
      const fieldsOf = (kind: OffSystemKind) =>
        JSON.stringify(
          sets.flatMap(([fields, prefix]) =>
            tokenFieldsOf(fields, prefix).flatMap((f) =>
              f.kind === kind && f.value !== undefined
                ? [[f.field, f.value]]
                : []
            )
          )
        );
      const owner: ValueNode = {
        fieldsOf,
        id: node.id,
        name: node.name ?? node.id,
      };
      for (const [fields, prefix] of sets) {
        found.push(...offIn(fields, prefix, owner, spacingBase));
      }
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return found;
};
