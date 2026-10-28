/**
 * A node's fields that the inspector and the element toolbar both edit, each declared once: how
 * the nodes selected read as one value (`MIXED` when they differ), what a value written sets on a
 * node (`null` takes a field off), what its undo step is called and which tokens it offers. Both
 * surfaces draw a field from here; neither reads nor writes it by hand. The nodes are read as
 * their view draws them, and a write lands at the view's breakpoint (`node-actions`, ADR 0036).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { TextStyle } from "@ultrapaint/contracts/design-system";
import type { DesignNode, TextAlign } from "@ultrapaint/contracts/document";
import { attachTextStyle } from "@ultrapaint/design-document/text-styles";
import { type Shared, sharedValue } from "./shared-value.ts";
import type { FieldTokenKind } from "./token-options.tsx";

export interface NodeField<Read extends JsonValue, Write> {
  /** The node's field. */
  readonly key: string;
  /** What the undo step of setting `value` is called. */
  readonly label: (value: Write) => string;
  /** What a node holds, as drawn: `undefined` when it has none, or `unset` for a field that has one. */
  readonly read: (node: DesignNode) => Read | undefined;
  /** The value a node without the field is drawn with, where that is a value of the field. */
  readonly unset?: Read;
  /** The fields setting `value` writes on each node. */
  readonly write: (value: Write) => Record<string, JsonValue>;
}

/** A field whose value is a token or a CSS value, picked from the tokens of one kind. */
export interface TokenValueField extends NodeField<JsonValue, JsonValue> {
  readonly options: FieldTokenKind;
}

const tokenValue = (
  key: string,
  noun: string,
  options: FieldTokenKind,
  read: (node: DesignNode) => JsonValue | undefined
): TokenValueField => ({
  key,
  label: () => `Change the ${noun}`,
  options,
  read,
  write: (value) => ({ [key]: value }),
});

/** A text's alignment: unset and `start` are one value, written as unset. */
export const ALIGN: NodeField<TextAlign, TextAlign> = {
  key: "align",
  label: () => "Align the text",
  read: (node) => (node.type === "text" ? (node.align ?? "start") : undefined),
  unset: "start",
  write: (align) => ({ align: align === "start" ? null : align }),
};

/** The text style a text is set in, by name; setting one sets the text in it. */
export const TEXT_STYLE: NodeField<string, TextStyle> = {
  key: "textStyle",
  label: (style) => `Set the text in ${style.name}`,
  read: (node) => (node.type === "text" ? node.textStyle : undefined),
  write: attachTextStyle,
};

/** The fields picked from tokens, by the name the element toolbar's controls give them. */
export const TOKEN_FIELDS = {
  color: tokenValue("color", "colour", "color", (node) =>
    node.type === "text" ? node.color : undefined
  ),
  fill: tokenValue("fill", "fill", "color", (node) => node.fill),
  gap: tokenValue("gap", "gap", "spacing", (node) =>
    node.type === "page" || node.type === "row" || node.type === "column"
      ? node.gap
      : undefined
  ),
  radius: tokenValue("radius", "radius", "radius", (node) => node.radius),
  shadow: tokenValue("shadow", "shadow", "shadow", (node) => node.shadow),
  tint: tokenValue("tint", "tint", "color", (node) =>
    node.type === "image" ? node.tint : undefined
  ),
} as const satisfies Record<string, TokenValueField>;

export type TokenFieldName = keyof typeof TOKEN_FIELDS;

const ALL: readonly NodeField<JsonValue, never>[] = [
  ALIGN,
  TEXT_STYLE,
  ...Object.values(TOKEN_FIELDS),
];

/** What the nodes have in a field: the value they share, `undefined` for none, or `MIXED`. */
export const sharedField = <Read extends JsonValue>(
  field: NodeField<Read, never>,
  nodes: readonly DesignNode[]
): Shared<Read> => sharedValue(nodes.map(field.read));

/**
 * The value a node without the field `key` is drawn with, where that is a value of the field (a
 * text's align, `start`); `undefined` otherwise. Unset at a breakpoint, the field is that value.
 */
export const unsetValueOf = (
  node: DesignNode,
  key: string
): JsonValue | undefined =>
  // A field with an unset value reads it of every node that has the field.
  ALL.find(
    (f) => f.key === key && f.unset !== undefined && f.read(node) !== undefined
  )?.unset;
