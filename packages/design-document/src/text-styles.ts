/**
 * A text and its text style: attached, the text takes its size, weight and line height (and
 * family and tracking) from the style as one thing; detached, it carries the same settings as
 * fields of its own and each can change on its own. Both are one `update` op, computed here.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  TEXT_STYLE_SETTINGS,
  type TextStyle,
  textStyleGroup,
} from "@ultrapaint/contracts/design-system";
import type { TextNode } from "@ultrapaint/contracts/document";

/**
 * The fields that take a text off its style and keep it looking the same: the style's settings
 * copied onto the node, except where the node already has its own.
 */
export const detachTextStyle = (
  node: TextNode,
  style: TextStyle | undefined
): Record<string, JsonValue> => {
  const set: Record<string, JsonValue> = { textStyle: null };
  for (const key of TEXT_STYLE_SETTINGS) {
    const own = node[key];
    const value = own ?? style?.[key];
    if (own === undefined && value !== undefined) {
      set[key] = value;
    }
  }
  return set;
};

/**
 * The fields that set a text in a style: the style's name, the settings the style stands for
 * taken off the node, and the role and level the style is meant for.
 */
export const attachTextStyle = (
  style: TextStyle
): Record<string, JsonValue> => {
  const set: Record<string, JsonValue> = { textStyle: style.name };
  for (const key of TEXT_STYLE_SETTINGS) {
    set[key] = null;
  }
  set.role = style.role;
  set.level = style.role === "heading" ? (style.level ?? 1) : null;
  return set;
};

const sameSettings = (node: TextNode, style: TextStyle) =>
  TEXT_STYLE_SETTINGS.every((key) => {
    const own = node[key];
    const theirs = style[key];
    return own === undefined || theirs === undefined || own === theirs;
  }) && TEXT_STYLE_SETTINGS.some((key) => node[key] !== undefined);

/**
 * The style a detached text goes back to: the one it matches setting for setting, else the one
 * meant for its role and level, else the first of its group.
 */
export const matchTextStyle = (
  node: TextNode,
  styles: readonly TextStyle[]
): TextStyle | undefined => {
  const group = node.role === "heading" ? "heading" : "body";
  return (
    styles.find((s) => sameSettings(node, s)) ??
    styles.find(
      (s) =>
        s.role === node.role &&
        (node.role !== "heading" || s.level === (node.level ?? 1))
    ) ??
    styles.find((s) => textStyleGroup(s) === group) ??
    styles[0]
  );
};

/** The styles in their groups, in the groups' order, for a list to show them under headings. */
export const groupTextStyles = <T extends TextStyle>(
  styles: readonly T[]
): ReadonlyMap<ReturnType<typeof textStyleGroup>, T[]> => {
  const groups = new Map<ReturnType<typeof textStyleGroup>, T[]>([
    ["heading", []],
    ["body", []],
    ["other", []],
  ]);
  for (const style of styles) {
    groups.get(textStyleGroup(style))?.push(style);
  }
  return groups;
};
