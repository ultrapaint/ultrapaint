/**
 * The nodes of a tree that hold a value: what an agent asks for to change a colour, a spacing or
 * a radius everywhere it is used (`read_page`'s `match`). The value is written as a page writes
 * one: `$name` a token, a bare number pixels (a weight's or a line height's a number), anything
 * else CSS.
 *
 * Values are compared in the design system's default theme with the tokens they name followed
 * (`valueInTheme`), a step of the spacing scale as the base times the step unless a named spacing
 * holds it, by the token value's notion of the same value (`sameAs`). A token matched is found by
 * its name and by its value, in the fields of its kind; a value written by hand there whose
 * nearest token (`nearestToken`) comes to the token's value is a **near** hit. A value matched
 * that is no token is found in every field that holds it, and nothing is near it.
 *
 * The fields walked are the off-system check's (`tokenFieldsOf`), with its paths, and an image's
 * tint: at the node's own level and at each breakpoint, and on an instance its own fields and its
 * overrides by layer (ADR 0114). An instance's props are its component's, and its main
 * component's tree is not in the page. A fill is read layer by layer and a shadow list shadow by
 * shadow, a hit naming the part that holds the value. Pure.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  asTokenValue,
  nearestToken,
} from "@ultrapaint/contracts/nearest-token";
import { defaultTheme, valueInTheme } from "@ultrapaint/contracts/themes";
import {
  spacingBasePx,
  spacingStepOf,
  tokenKindOf,
} from "@ultrapaint/contracts/token-table";
import {
  type Comparable,
  comparable,
  formatNumber,
  sameAs,
} from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { layerColours, layeredFill } from "./fill.ts";
import {
  type OffSystemKind,
  type TokenField,
  tokenFieldsOf,
} from "./off-system.ts";
import { shadowsOf } from "./shadow.ts";
import { isToken, tokenName } from "./tokens.ts";
import { childrenOf } from "./tree.ts";

/** One field of a node holding the value matched. */
export interface ValueMatch {
  /** The field, with its side, breakpoint or layer: `padding.top`, `at.md.gap`, `overrides.title.color`. */
  readonly field: string;
  /** A near hit: the value of the token matched, which the field's own is near. */
  readonly near?: string;
  /** The node's id. */
  readonly node: string;
  /** For a value that names a token: what it comes to in the default theme. */
  readonly resolves?: string;
  /** What the field holds, or the layer or shadow of it that holds the value. */
  readonly value: string | number;
}

/** The token kind each field the off-system check reads is of. */
const TOKEN_KIND: Readonly<Record<OffSystemKind, TokenKind>> = {
  color: "color",
  font: "font",
  "line-height": "leading",
  radius: "radius",
  shadow: "shadow",
  spacing: "spacing",
  "text-size": "fontSize",
  tracking: "tracking",
  weight: "fontWeight",
};

const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** A match as a page writes it: a bare number is one. */
const asWritten = (match: string): string | number => {
  const text = match.trim();
  return NUMBER_RE.test(text) ? Number(text) : text;
};

const isBlank = (value: unknown) =>
  typeof value === "string" && value.trim() === "";

/** The parts of a field's value a token can stand for: a fill's colours, a shadow list's shadows. */
const partsOf = (kind: OffSystemKind, value: string | number) => {
  if (typeof value !== "string") {
    return [value];
  }
  if (kind === "shadow") {
    const shadows = shadowsOf(value);
    return shadows.length > 1 ? shadows : [value];
  }
  const layers = kind === "color" ? layeredFill(value) : null;
  if (layers) {
    return layerColours(layers);
  }
  return [value];
};

/** The fields of a node a token can stand for, an image's tint beside the check's. */
const fieldsOf = (
  fields: Readonly<Record<string, unknown>>,
  prefix: string
): TokenField[] => [
  ...tokenFieldsOf(fields, prefix),
  { field: `${prefix}tint`, kind: "color", value: fields.tint },
];

/** A record's own entries, none for anything else. */
const entriesOf = (value: unknown): [string, Record<string, unknown>][] =>
  typeof value === "object" && value !== null
    ? (Object.entries(value) as [string, Record<string, unknown>][])
    : [];

/** Every field of a node a token can stand for: its own, at each breakpoint, and its overrides. */
const nodeFields = (node: DesignNode): TokenField[] => {
  const own = node as unknown as Readonly<Record<string, unknown>>;
  const atEach = (
    fields: Readonly<Record<string, unknown>>,
    prefix: string
  ): TokenField[] =>
    entriesOf(fields.at).flatMap(([breakpoint, over]) =>
      fieldsOf({ ...over, type: node.type }, `${prefix}at.${breakpoint}.`)
    );
  const found = [...fieldsOf(own, ""), ...atEach(own, "")];
  if (node.type === "instance") {
    for (const [layer, fields] of entriesOf(node.overrides)) {
      const prefix = `overrides.${layer}.`;
      found.push(...fieldsOf(fields, prefix), ...atEach(fields, prefix));
    }
  }
  return found;
};

/**
 * What finds the value `match` in a tree, read once against the design system: each node of the
 * tree in order, and each of its fields in the off-system check's order.
 */
export const valueMatcher = (
  ds: DesignSystem,
  match: string
): ((root: DesignNode) => ValueMatch[]) => {
  const theme = defaultTheme(ds);
  const basePx = spacingBasePx(ds.spacing.base);
  /**
   * What a token comes to in the default theme, a step of the scale in pixels; none for a token
   * with no value, such as one whose value the code holds and the design system does not yet.
   */
  const comesTo = (name: string): string | undefined => {
    const found = valueInTheme(ds, name, theme, { follow: true })?.trim();
    const value = found === "" ? undefined : found;
    const step = spacingStepOf(name);
    return value === undefined && step !== null
      ? `${formatNumber(step * basePx)}px`
      : value;
  };
  const wanted = asWritten(match);
  const token = isToken(wanted) ? tokenName(wanted) : null;
  const tokenKind = token === null ? null : tokenKindOf(token);
  const tokenValue = token === null ? undefined : comesTo(token);
  const tokenComparable =
    tokenValue === undefined ? null : comparable(tokenValue);
  // A value matched, read once for each kind of field: 16 is 16px, but a weight's 16.
  const byKind = new Map<TokenKind, Comparable>();
  /** The value looked for, read as a field of this kind holds it: the token's value for a token. */
  const target = (kind: TokenKind): Comparable | null => {
    if (token !== null) {
      return tokenComparable;
    }
    let read = byKind.get(kind);
    if (!read) {
      read = comparable(asTokenValue(kind, wanted));
      byKind.set(kind, read);
    }
    return read;
  };

  const hitOf = (
    node: string,
    field: string,
    kind: TokenKind,
    value: string | number
  ): ValueMatch | null => {
    const sought = target(kind);
    if (isToken(value)) {
      const name = tokenName(value);
      const resolves = comesTo(name);
      const hit =
        name === token ||
        (sought !== null &&
          resolves !== undefined &&
          sameAs(comparable(resolves), sought));
      return hit
        ? { field, node, value, ...(resolves !== undefined && { resolves }) }
        : null;
    }
    if (sought === null) {
      return null;
    }
    if (sameAs(comparable(asTokenValue(kind, value)), sought)) {
      return { field, node, value };
    }
    // Near the token matched: the nearest token to the value comes to the token's value.
    const nearest =
      token === null || tokenValue === undefined
        ? null
        : nearestToken(kind, value, ds, { theme });
    return nearest !== null &&
      tokenValue !== undefined &&
      (nearest.name === token || sameAs(comparable(nearest.value), sought))
      ? { field, near: tokenValue, node, value }
      : null;
  };

  /** A node's hits: a token matched is looked for only in the fields of its kind. */
  const hitsOn = (node: DesignNode): ValueMatch[] =>
    nodeFields(node).flatMap(({ field, kind, value }) => {
      // An empty value holds nothing, and nothing is the same as it.
      if (wanted === "" || isBlank(value)) {
        return [];
      }
      const fieldKind = TOKEN_KIND[kind];
      if (
        (typeof value !== "string" && typeof value !== "number") ||
        (tokenKind !== null && tokenKind !== fieldKind)
      ) {
        return [];
      }
      return partsOf(kind, value).flatMap(
        (part) => hitOf(node.id, field, fieldKind, part) ?? []
      );
    });

  return (root) => {
    const found: ValueMatch[] = [];
    const visit = (node: DesignNode) => {
      found.push(...hitsOn(node));
      for (const child of childrenOf(node)) {
        visit(child);
      }
    };
    visit(root);
    return found;
  };
};
