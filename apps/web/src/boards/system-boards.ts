/**
 * Design system's places and their boards (ADR 0045): the Foundations the design system has data
 * for and the Guidelines, DESIGN.md's sections, each an item of the board view, and the boards it
 * opens as, generated documents the canvas's renderer draws. Pure: the board view and its list
 * read them, the tests too.
 *
 * The boards drawn here are the shell's (Phase 4): a palette's swatches, a foundation's tokens as
 * rows, a guideline's text. A node a board draws for something that can be picked is named for
 * it (`token:color-primary-600`), so a click on it picks that (B6).
 */
import type {
  DesignDocument,
  DesignSystem,
  Token,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { tokensOfKind } from "@ultrapaint/contracts/token-table";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { tokenRef } from "@ultrapaint/design-document/tokens";

/** A board of an item: a generated document drawn as a frame, named within the item. */
export interface Board {
  /** Unique within the item: the last part of its frame id. */
  readonly name: string;
  readonly root: DesignNode;
  /** Over its frame, beside the item's name. */
  readonly title: string;
}

/** An item's boards, and whether they are laid out side by side or one under the other. */
export interface Boards {
  readonly boards: readonly Board[];
  readonly direction: "row" | "column";
}

/** An entry of Design system's list. */
export interface SystemItem {
  /** How many tokens (or styles, or levels) it has; what the search found of them while it searches. */
  readonly count: number;
  /** Its id in the URL and the board view (`color`, `guide-colors`). */
  readonly id: string;
  readonly name: string;
}

/** The foundations a design system can have, in Design system's order, with the tokens of each. */
export const FOUNDATIONS: readonly {
  readonly id: string;
  readonly kinds: readonly TokenKind[];
  readonly name: string;
}[] = [
  { id: "color", kinds: ["color"], name: "Color" },
  {
    id: "typography",
    kinds: ["font", "fontSize", "fontWeight", "leading", "tracking"],
    name: "Typography",
  },
  { id: "spacing", kinds: ["spacing"], name: "Spacing" },
  { id: "radius", kinds: ["radius"], name: "Radius" },
  { id: "elevation", kinds: ["shadow"], name: "Elevation" },
  { id: "motion", kinds: ["easing", "duration", "animation"], name: "Motion" },
  {
    id: "breakpoints",
    kinds: ["breakpoint", "container"],
    name: "Breakpoints",
  },
];

/** The colour tokens every design draws with until it says otherwise (`system-components/look`). */
const NEUTRAL_COLORS = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "card",
  "popover",
].map((name) => `color-${name}`);

const matches = (token: { name: string; value: string }, q: string) =>
  !q ||
  token.name.toLowerCase().includes(q) ||
  token.value.toLowerCase().includes(q);

/** A foundation's tokens, those a search finds. */
const tokensOf = (
  ds: DesignSystem,
  kinds: readonly TokenKind[],
  q: string
): Token[] =>
  kinds.flatMap((kind) => tokensOfKind(ds, kind)).filter((t) => matches(t, q));

/** What a foundation has besides its tokens: a typography's styles, an elevation's levels. */
const extrasOf = (ds: DesignSystem, id: string, q: string) => {
  const named = (list: readonly { name: string }[]) =>
    list.filter((x) => !q || x.name.toLowerCase().includes(q)).length;
  if (id === "typography") {
    return named(ds.typography.styles);
  }
  return id === "elevation" ? named(ds.elevation ?? []) : 0;
};

/**
 * The foundations the design system has data for, with how many of their tokens a search finds;
 * while it searches, those it finds none in are left out. Without a design system, Color alone:
 * the neutral palette every design draws with until it has one.
 */
export const foundationsOf = (
  ds: DesignSystem | null,
  query = ""
): SystemItem[] => {
  const q = query.trim().toLowerCase();
  if (!ds) {
    const count = NEUTRAL_COLORS.filter((name) =>
      matches({ name, value: "" }, q)
    ).length;
    return count > 0 || !q ? [{ count, id: "color", name: "Color" }] : [];
  }
  return FOUNDATIONS.flatMap((f) => {
    const count = tokensOf(ds, f.kinds, q).length + extrasOf(ds, f.id, q);
    // The spacing base is always there: a design system always has spacing.
    const shown = count > 0 || (f.id === "spacing" && !q);
    return shown ? [{ count, id: f.id, name: f.name }] : [];
  });
};

const GUIDE_PREFIX = "guide-";
const COLOR_PREFIX = /^color-/;
const BLANK_LINE = /\n\s*\n/;
const NOT_WORD = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-|-$/g;

/** A guideline's id, from its heading: `Do's and Don'ts` is `guide-do-s-and-don-ts`. */
export const guidelineId = (heading: string) =>
  `${GUIDE_PREFIX}${heading.toLowerCase().replace(NOT_WORD, "-").replace(EDGE_DASHES, "")}`;

/** DESIGN.md's sections, in its order, a search keeping those whose heading or text has it. */
export const guidelinesOf = (
  document: DesignDocument | null,
  query = ""
): SystemItem[] => {
  const q = query.trim().toLowerCase();
  return (document?.sections ?? [])
    .filter(
      (s) =>
        !q ||
        s.heading.toLowerCase().includes(q) ||
        s.text.toLowerCase().includes(q)
    )
    .map((s) => ({ count: 0, id: guidelineId(s.heading), name: s.heading }));
};

/** What an item of Design system is called, for the board's title and Back; its id if unknown. */
export const systemItemName = (
  item: string,
  document: DesignDocument | null
): string =>
  FOUNDATIONS.find((f) => f.id === item)?.name ??
  document?.sections.find((s) => guidelineId(s.heading) === item)?.heading ??
  item;

// ---- Boards ----

const MUTED = "#71717a";

const label = (id: string, text: string, size = 11): DesignNode => ({
  color: MUTED,
  id,
  role: "paragraph",
  size,
  text,
  type: "text",
});

/** A board's root: a sheet of the design's background, at a width of its own. */
const sheet = (
  id: string,
  children: DesignNode[],
  width: number
): DesignNode => ({
  children,
  fill: tokenRef("color-background"),
  gap: 20,
  id,
  padding: 24,
  radius: 8,
  type: "column",
  width,
});

/** A swatch of a colour token, named for it: a click on it picks the token. */
const swatch = (name: string): DesignNode => ({
  children: [
    {
      border: { color: "#00000014", width: 1 },
      children: [],
      fill: tokenRef(name),
      height: 40,
      id: `fill:${name}`,
      radius: 6,
      type: "group",
      width: 64,
    },
    label(`name:${name}`, name.replace(COLOR_PREFIX, ""), 10),
  ],
  gap: 4,
  id: `token:${name}`,
  type: "column",
  width: 64,
});

/** Every palette as a row of swatches; without a design system, the neutral one. */
const colorBoards = (ds: DesignSystem | null, q: string): Boards => {
  const groups = ds
    ? ds.colors.map((g) => ({
        name: g.name,
        tokens: g.tokens
          .map((t) => t.name)
          .filter((n) => matches({ name: n, value: "" }, q)),
      }))
    : [{ name: "neutral", tokens: NEUTRAL_COLORS }];
  const rows = groups
    .filter((g) => g.tokens.length > 0)
    .map(
      (g, i): DesignNode => ({
        children: [
          label(`group-label-${i}`, g.name),
          {
            children: g.tokens.map(swatch),
            gap: 8,
            id: `group-swatches-${i}`,
            type: "row",
            wrap: true,
          },
        ],
        gap: 6,
        id: `group:${g.name}`,
        type: "column",
      })
    );
  return {
    boards: [
      { name: "palette", root: sheet("palette", rows, 720), title: "Palette" },
    ],
    direction: "row",
  };
};

/** A foundation's tokens as rows of their name and value, each named for its token. */
const tokenRowsBoard = (title: string, tokens: readonly Token[]): Board => ({
  name: "tokens",
  root: sheet(
    "tokens",
    tokens.length === 0
      ? [label("empty", "Nothing here yet", 13)]
      : tokens.map(
          (t): DesignNode => ({
            children: [
              {
                id: `token-name:${t.name}`,
                role: "paragraph",
                size: 13,
                text: t.name,
                type: "text",
                width: 240,
              },
              label(`token-value:${t.name}`, t.value, 13),
            ],
            gap: 16,
            id: `token:${t.name}`,
            type: "row",
          })
        ),
    640
  ),
  title,
});

/** Each text style set in itself, named for it; the type scale under it. */
const typographyBoards = (ds: DesignSystem, q: string): Boards => {
  const styles = ds.typography.styles.filter(
    (s) => !q || s.name.toLowerCase().includes(q)
  );
  const styleRows = styles.map(
    (style): DesignNode => ({
      children: [
        label(`style-label:${style.name}`, style.name),
        {
          id: `style-sample:${style.name}`,
          ...(style.level !== undefined && { level: style.level }),
          role: style.role,
          text: "The quick brown fox jumps over the lazy dog",
          textStyle: style.name,
          type: "text",
        },
      ],
      gap: 4,
      id: `style:${style.name}`,
      type: "column",
    })
  );
  const sizes = tokensOfKind(ds, "fontSize")
    .filter((t) => matches(t, q))
    .map(
      (size): DesignNode => ({
        children: [
          label(`size-label:${size.name}`, `${size.name} · ${size.value}`),
          {
            id: `size-sample:${size.name}`,
            role: "paragraph",
            size: tokenRef(size.name),
            text: "The quick brown fox",
            type: "text",
          },
        ],
        gap: 2,
        id: `token:${size.name}`,
        type: "column",
      })
    );
  return {
    boards: [
      ...(styleRows.length > 0
        ? [
            {
              name: "styles",
              root: sheet("styles", styleRows, 720),
              title: "Text styles",
            },
          ]
        : []),
      ...(sizes.length > 0
        ? [
            {
              name: "scale",
              root: sheet("scale", sizes, 720),
              title: "Type scale",
            },
          ]
        : []),
    ],
    direction: "column",
  };
};

/** A guideline as a readable document: its heading, then its paragraphs. */
const guidelineBoards = (
  document: DesignDocument | null,
  item: string
): Boards => {
  const section = document?.sections.find(
    (s) => guidelineId(s.heading) === item
  );
  if (!section) {
    return { boards: [], direction: "column" };
  }
  const paragraphs = section.text
    .split(BLANK_LINE)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(
      (text, i): DesignNode => ({
        id: `paragraph-${i}`,
        role: "paragraph",
        size: 15,
        text,
        type: "text",
      })
    );
  return {
    boards: [
      {
        name: "document",
        root: sheet(
          "document",
          [
            {
              id: "heading",
              level: 2,
              role: "heading",
              text: section.heading,
              type: "text",
            },
            ...paragraphs,
          ],
          720
        ),
        title: "DESIGN.md",
      },
    ],
    direction: "column",
  };
};

/** The boards of an item of Design system; none for an item it does not have. */
export const systemBoards = (
  item: string,
  ds: DesignSystem | null,
  document: DesignDocument | null,
  query = ""
): Boards => {
  const q = query.trim().toLowerCase();
  if (item === "color") {
    return colorBoards(ds, q);
  }
  if (item.startsWith(GUIDE_PREFIX)) {
    return guidelineBoards(document, item);
  }
  const foundation = FOUNDATIONS.find((f) => f.id === item);
  if (!(ds && foundation)) {
    return { boards: [], direction: "column" };
  }
  if (item === "typography") {
    return typographyBoards(ds, q);
  }
  return {
    boards: [tokenRowsBoard("Tokens", tokensOf(ds, foundation.kinds, q))],
    direction: "column",
  };
};
