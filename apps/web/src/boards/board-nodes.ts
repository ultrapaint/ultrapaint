/**
 * The pieces Design system's boards are made of (ADR 0045): a sheet in the design's background,
 * the documentation around the specimens (titles, names, values) set in the editor's own type, a
 * section's title, rows split by hairlines, and a token's value in the theme a board is drawn in.
 * The documentation's colours are the sheet's text colour and steps of it, so they read on a
 * light sheet and a dark one alike; the specimens are the design's. Pure; the nodes are a
 * generated document's, drawn by the page renderer.
 */
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { tokensOfKind } from "@ultrapaint/contracts/token-table";
import { ROOT_PX, toPx } from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import { NODE_ATTRIBUTE } from "@ultrapaint/preview-core/preview";
import { pickId } from "./pick.ts";

/**
 * The selector of what the renderer draws for a board's node (its `NODE_ATTRIBUTE`), for what a
 * board's own stylesheet says that a document cannot: every node whose id is `id`, or with `^=`
 * every one whose id starts so. Board ids are the editor's own, written without quotes.
 */
export const nodeCss = (id: string, match: "=" | "^=" = "=") =>
  `[${NODE_ATTRIBUTE}${match}"${id}"]`;

/** Whether a search (lower-cased) finds a token, by its name or its value; any, with none. */
export const found = (token: { name: string; value: string }, q: string) =>
  !q ||
  token.name.toLowerCase().includes(q) ||
  token.value.toLowerCase().includes(q);

/** The design system's tokens of a kind, or of several, that a search finds, in its order. */
export const tokensFound = (
  ds: DesignSystem,
  kinds: TokenKind | readonly TokenKind[],
  q: string
): Token[] =>
  (typeof kinds === "string" ? [kinds] : kinds)
    .flatMap((kind) => tokensOfKind(ds, kind))
    .filter((t) => found(t, q));

/** The editor's face, which the boards' documentation is set in (the editor loads it). */
export const UI_FONT =
  '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, sans-serif';

/** The editor's mono, for a token's name and value. */
export const MONO =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** A step of the sheet's text colour: what qualifies its neighbour, on any sheet. */
export const MUTED = "color-mix(in oklab, currentColor 58%, transparent)";

/** A hairline between rows, and the edge of a swatch, in the sheet's text colour. */
export const RULE = "color-mix(in oklab, currentColor 11%, transparent)";

/** A quiet well a specimen sits on, so a surface the colour of the sheet still shows. */
export const WELL = "color-mix(in oklab, currentColor 5%, transparent)";

/**
 * What draws a length or a movement: the design's primary colour, else its text colour. A
 * specimen of the design, so in its own colour, not the editor's.
 */
export const INK = "var(--color-primary, currentColor)";

type TextExtra = Partial<Extract<DesignNode, { type: "text" }>>;

/** The documentation's quiet text: a group's name, a value, a description. */
export const label = (
  id: string,
  content: string,
  size = 12,
  extra: TextExtra = {}
): DesignNode => ({
  color: MUTED,
  font: UI_FONT,
  id,
  lineHeight: 1.4,
  role: "paragraph",
  size,
  text: content,
  type: "text",
  ...extra,
});

/** The documentation's names: a token's, a style's, a section's title, in the sheet's colour. */
export const nameText = (
  id: string,
  content: string,
  size = 13,
  extra: TextExtra = {}
): DesignNode => ({
  font: UI_FONT,
  id,
  lineHeight: 1.4,
  role: "paragraph",
  size,
  text: content,
  type: "text",
  weight: 500,
  ...extra,
});

/** A specimen's text, in the design's own face and colour. */
export const text = (
  id: string,
  content: string,
  size = 13,
  extra: TextExtra = {}
): DesignNode => ({
  id,
  role: "paragraph",
  size,
  text: content,
  type: "text",
  ...extra,
});

/** A token's name in mono, in the sheet's colour, and its value under it, muted. */
export const code = (
  id: string,
  content: string,
  size = 12,
  extra: TextExtra = {}
): DesignNode => ({
  color: MUTED,
  font: MONO,
  id,
  lineHeight: 1.45,
  role: "paragraph",
  size,
  text: content,
  type: "text",
  ...extra,
});

/** A length as pixels, an `em` at the root's size; 0 when it is none. */
export const pxOf = (value: string) => toPx(value, { em: ROOT_PX }) ?? 0;

/** A length as it is given, with its pixels after it when it is not in pixels already. */
export const withPx = (value: string): string => {
  const px = toPx(value, { em: ROOT_PX });
  if (px === null || value.trim().endsWith("px")) {
    return value;
  }
  return `${value} · ${Math.round(px * 100) / 100}px`;
};

/** A board's root: a sheet of the design's background, at a width of its own. */
export const sheet = (
  id: string,
  children: DesignNode[],
  width: number,
  gap = 32
): DesignNode => ({
  children,
  fill: tokenRef("color-background"),
  gap,
  id,
  padding: 32,
  radius: 12,
  type: "column",
  width,
});

/** A section of a sheet: its title, then what it holds. */
export const section = (
  id: string,
  title: string,
  children: DesignNode[],
  gap = 12
): DesignNode => ({
  children: [nameText(`${id}-title`, title, 14, { weight: 600 }), ...children],
  gap,
  id,
  type: "column",
  width: "fill",
});

/** Rows of one kind split by hairlines: each but the first ruled above, all evenly padded. */
export const ruled = (
  rows: readonly DesignNode[],
  padding = 12
): DesignNode[] =>
  rows.map((row, i) => ({
    ...row,
    ...(i > 0 && { border: { color: RULE, width: "1px 0 0 0" } }),
    padding: { bottom: padding, top: i === 0 ? 0 : padding },
  }));

/**
 * A token as a row: what it shows, then its name, its value and what it is for one under the
 * other, named for it so a click picks it.
 */
export const tokenRow = (
  token: Pick<Token, "name" | "value" | "description">,
  preview: DesignNode,
  previewWidth = 72,
  /** Where the specimen sits in its column: a bar starts at its left, to compare lengths. */
  align: "center" | "start" = "center",
  /** The value as it reads; the token's own by default. */
  value = token.value
): DesignNode => ({
  children: [
    {
      align,
      children: [preview],
      crossAlign: "center",
      id: `preview:${token.name}`,
      type: "row",
      width: previewWidth,
    },
    {
      children: [
        code(`name:${token.name}`, token.name, 12.5, {
          color: "currentColor",
        }),
        code(`value:${token.name}`, value, 12),
        ...(token.description
          ? [
              label(`about:${token.name}`, token.description, 12, {
                width: "fill",
              }),
            ]
          : []),
      ],
      gap: 2,
      id: `names:${token.name}`,
      type: "column",
      width: "fill",
    },
  ],
  crossAlign: "center",
  gap: 24,
  id: pickId({ kind: "token", name: token.name }),
  type: "row",
  width: "fill",
});
