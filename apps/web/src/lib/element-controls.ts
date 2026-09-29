/**
 * What the Vibe toolbar offers for a node, and in which order. Only what the design system has:
 * a component's own variants, a text's styles, and the colour, radius, spacing and shadow tokens
 * of a container. At most two props of a component show; the rest wait behind "+ n".
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { TokenKind } from "./token-options.tsx";

export type TokenField =
  | "color"
  | "fill"
  | "gap"
  | "padding"
  | "radius"
  | "shadow";

export type Control =
  | {
      readonly kind: "prop";
      readonly name: string;
      readonly options: readonly string[];
    }
  | { readonly kind: "textStyle" }
  | { readonly kind: "align" }
  | {
      readonly field: TokenField;
      readonly kind: "token";
      readonly token: TokenKind;
    };

/** A component's props the toolbar shows before "+ n". */
export const SHOWN_PROPS = 2;

const token = (field: TokenField, kind: TokenKind): Control => ({
  field,
  kind: "token",
  token: kind,
});

export const controlsOf = (
  node: DesignNode,
  variants: Readonly<Record<string, readonly string[]>> | undefined
): {
  readonly more: readonly Control[];
  readonly shown: readonly Control[];
} => {
  switch (node.type) {
    case "instance": {
      const props: Control[] = Object.entries(variants ?? {})
        .filter(([, options]) => options.length > 1)
        .map(([name, options]) => ({ kind: "prop", name, options }));
      return {
        more: props.slice(SHOWN_PROPS),
        shown: props.slice(0, SHOWN_PROPS),
      };
    }
    case "text":
      return {
        more: [],
        shown: [
          { kind: "textStyle" },
          token("color", "color"),
          { kind: "align" },
        ],
      };
    case "image":
      return { more: [], shown: [token("radius", "radius")] };
    case "group":
      return {
        more: [],
        shown: [
          token("fill", "color"),
          token("radius", "radius"),
          token("padding", "spacing"),
          token("shadow", "shadow"),
        ],
      };
    default:
      return {
        more: [],
        shown: [
          token("fill", "color"),
          token("radius", "radius"),
          token("padding", "spacing"),
          token("gap", "spacing"),
          token("shadow", "shadow"),
        ],
      };
  }
};

/**
 * The value a prop shows: what the node sets, else the variant a component falls back on —
 * `default` when it has one, which is cva's convention — else the first.
 */
export const propValue = (
  props: Readonly<Record<string, JsonValue>> | undefined,
  name: string,
  options: readonly string[]
): string => {
  const set = props?.[name];
  if (typeof set === "string" || typeof set === "number") {
    return String(set);
  }
  return options.includes("default") ? "default" : (options[0] ?? "");
};

const PREFIX: Record<TokenField, string> = {
  color: "color-",
  fill: "color-",
  gap: "spacing-",
  padding: "spacing-",
  radius: "radius-",
  shadow: "shadow-",
};

/**
 * A field's value as the toolbar shows it: a token by its short name (`card`, `lg`), pixels on the
 * spacing scale as its step (`4` for 16px on a 4px base), `mixed` for per-side padding, `none`
 * when unset.
 */
export const tokenLabel = (
  field: TokenField,
  value: JsonValue | undefined,
  spacingBase: number
): string => {
  if (value === undefined || value === null || value === "") {
    return "none";
  }
  if (typeof value === "object") {
    return "mixed";
  }
  if (typeof value === "number") {
    if (field === "gap" || field === "padding") {
      const step = value / spacingBase;
      return Number.isInteger(step * 2) ? String(step) : `${value}px`;
    }
    return `${value}px`;
  }
  const text = String(value);
  if (text.startsWith("$")) {
    const name = text.slice(1);
    const prefix = PREFIX[field];
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  }
  return text;
};
