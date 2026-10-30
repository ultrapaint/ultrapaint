/**
 * The pieces Design system's boards are made of (ADR 0045): a sheet in the design's background,
 * labels in a quiet grey, a section's title, and a token's value in the theme a board is drawn
 * in. Pure; the nodes are a generated document's, drawn by the page renderer.
 */
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { tokenOf, tokensOfKind } from "@ultrapaint/contracts/token-table";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import { NODE_ATTRIBUTE } from "@ultrapaint/preview-core/preview";

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

/** A label's grey, legible on a light sheet and a dark one. */
const MUTED = "#8a8a93";

export const label = (
  id: string,
  content: string,
  size = 11,
  extra: Partial<Extract<DesignNode, { type: "text" }>> = {}
): DesignNode => ({
  color: MUTED,
  id,
  role: "paragraph",
  size,
  text: content,
  type: "text",
  ...extra,
});

/** Text in the design's own colour. */
export const text = (
  id: string,
  content: string,
  size = 13,
  extra: Partial<Extract<DesignNode, { type: "text" }>> = {}
): DesignNode => ({
  id,
  role: "paragraph",
  size,
  text: content,
  type: "text",
  ...extra,
});

/** Monospace, for a token's name and value. */
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** A board's root: a sheet of the design's background, at a width of its own. */
export const sheet = (
  id: string,
  children: DesignNode[],
  width: number,
  gap = 20
): DesignNode => ({
  children,
  fill: tokenRef("color-background"),
  gap,
  id,
  padding: 24,
  radius: 8,
  type: "column",
  width,
});

/** A section of a sheet: its title, then what it holds. */
export const section = (
  id: string,
  title: string,
  children: DesignNode[],
  gap = 10
): DesignNode => ({
  children: [label(`${id}-title`, title, 11, { weight: 600 }), ...children],
  gap,
  id,
  type: "column",
  width: "fill",
});

/**
 * A token as a row: what it shows, then its name, its value and what it is for one under the
 * other, named for it so a click picks it.
 */
export const tokenRow = (
  token: Pick<Token, "name" | "value" | "description">,
  preview: DesignNode,
  previewWidth = 72,
  /** Where the specimen sits in its column: a bar starts at its left, to compare lengths. */
  align: "center" | "start" = "center"
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
        text(`name:${token.name}`, token.name, 13, { font: MONO }),
        label(`value:${token.name}`, token.value, 11, { font: MONO }),
        ...(token.description
          ? [label(`about:${token.name}`, token.description, 11)]
          : []),
      ],
      gap: 2,
      id: `names:${token.name}`,
      type: "column",
      width: "fill",
    },
  ],
  crossAlign: "center",
  gap: 16,
  id: `token:${token.name}`,
  padding: { bottom: 6, top: 6 },
  type: "row",
  width: "fill",
});

const VAR_RE = /^var\(--([\w.-]+)\)$/;

/** The theme a design system's plain values are in: its first. */
export const firstTheme = (ds: DesignSystem): string =>
  ds.themes?.[0] ?? "light";

/**
 * A token's value in a theme, the default theme's where it has none; a value that is another
 * token (`var(--color-blue-600)`, `$color-blue-600`) followed to that one's, a few deep.
 */
export const valueIn = (
  ds: DesignSystem,
  name: string,
  theme: string
): string | undefined => {
  let current = name;
  for (let depth = 0; depth < 5; depth += 1) {
    const token = tokenOf(ds, current);
    if (!token) {
      return undefined;
    }
    const value =
      theme === firstTheme(ds)
        ? token.value
        : (token.values?.[theme] ?? token.value);
    const alias: RegExpExecArray | null = VAR_RE.exec(value.trim());
    const next = value.startsWith("$") ? value.slice(1) : alias?.[1];
    if (next === undefined) {
      return value;
    }
    current = next;
  }
  return undefined;
};

/** Whether a theme is a dark one, by its name: what the boards' own greys and grades follow. */
export const isDark = (theme: string) => theme.toLowerCase().includes("dark");
