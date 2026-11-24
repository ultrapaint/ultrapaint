/**
 * A box's shadows: the one CSS box-shadow a node's `shadow` holds, read as its list and written
 * back. The document keeps the string (ADR 0015); each shadow of it is a token (`$shadow-md`) or
 * CSS (`inset 0 1px 0 #fff`), the first drawn on top, as CSS paints a box-shadow list. This is the
 * one reader of a list: the canvas, the class writer, the tokens used, the off-system check and
 * the inspector all split it here. Pure.
 */

import { splitTop } from "./css-split.ts";

const TOKEN_RE = /^\$([a-z0-9][\w.-]*)/i;

/**
 * A shadow as its shadows, the top one first, split on the commas outside brackets so that a
 * colour (`rgba(0,0,0,.1)`) stays whole; none for no shadow.
 */
export const shadowsOf = (shadow: string | null | undefined): string[] =>
  splitTop(shadow ?? "", ",").filter((s) => s !== "");

/** Shadows as the one list a node's `shadow` holds, the first on top; null for none. */
export const shadowListCss = (shadows: readonly string[]): string | null =>
  shadows.length === 0 ? null : shadows.join(", ");

/** The token each shadow that is one names, in order: `$shadow-md` is `shadow-md`. */
export const tokensInShadow = (shadow: string): string[] =>
  shadowsOf(shadow).flatMap((s) => {
    const found: RegExpExecArray | null = TOKEN_RE.exec(s);
    const name = found ? found[1] : undefined;
    return name === undefined ? [] : [name];
  });

/**
 * A shadow with each of its shadows as `each` says it, a token as its variable; a value with no
 * shadow in it as `each` says it whole.
 */
export const mapShadows = (
  shadow: string,
  each: (shadow: string) => string
): string => {
  const shadows = shadowsOf(shadow);
  return shadows.length > 0 ? shadows.map(each).join(", ") : each(shadow);
};
