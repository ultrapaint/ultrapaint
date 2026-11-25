/**
 * Style fields: the fields of a node that are its look, per type, so that a look is copied off
 * one node and pasted onto others. A box's fill, border, radius, shadow, opacity, padding and the
 * blur behind it; a row's or column's spacing and alignment; a text's text style and its own
 * settings over it; an image's fit and tint. Nothing else is style: what a node says or shows, its
 * size, its margin, its place, what it is, and how a container lays its children out (its
 * direction, its type).
 * Not the node style, which is what the fields mean as CSS (`css.ts`).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { TEXT_STYLE_SETTINGS } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";

type Type = DesignNode["type"];

/** Every node's: its box's look. */
const BOX = [
  "fill",
  "border",
  "radius",
  "shadow",
  "opacity",
  "padding",
  "backdropBlur",
];

/**
 * What each kind of node adds, by kind: a field is the same field only within one, as a text's
 * align (where its lines sit) is not a stack's (where its children sit).
 */
const KINDS = {
  box: [],
  image: ["fit", "tint"],
  stack: ["gap", "align", "crossAlign", "wrap"],
  text: ["textStyle", ...TEXT_STYLE_SETTINGS, "color", "align"],
} as const satisfies Record<string, readonly string[]>;

/** Each type's kind: a page's too, for every type to have one, though the editor copies none. */
const KIND_OF: { readonly [T in Type]: keyof typeof KINDS } = {
  column: "stack",
  group: "box",
  image: "image",
  instance: "box",
  page: "stack",
  row: "stack",
  text: "text",
};

/** The style fields of a node of this type. */
export const styleFieldsOf = (type: Type): readonly string[] => [
  ...BOX,
  ...KINDS[KIND_OF[type]],
];

/** A node's look as copied: the style fields it sets, and the type it was copied off. */
export interface CopiedStyle {
  readonly fields: Readonly<Record<string, JsonValue>>;
  readonly type: Type;
}

/** The style of a node: the style fields it sets, read off it as given. */
export const styleOf = (node: DesignNode): CopiedStyle => {
  const own = node as unknown as Readonly<
    Record<string, JsonValue | undefined>
  >;
  const fields: Record<string, JsonValue> = {};
  for (const key of styleFieldsOf(node.type)) {
    const value = own[key];
    if (value !== undefined) {
      fields[key] = value;
    }
  }
  return { fields, type: node.type };
};

/**
 * What a node of this type takes of a copied style: its box's look, and its kind's own fields when
 * the copy is of its kind, each set as copied or `null` where the copy leaves it unset, so that
 * the node looks as the copy did. What only the other kind has is not the copy's to say.
 */
export const styleFor = (
  style: CopiedStyle,
  type: Type
): Record<string, JsonValue> => {
  const fields =
    KIND_OF[style.type] === KIND_OF[type] ? styleFieldsOf(type) : BOX;
  return Object.fromEntries(
    fields.map((key) => [key, style.fields[key] ?? null])
  );
};
