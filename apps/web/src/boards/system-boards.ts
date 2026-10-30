/**
 * Design system's places and their boards (ADR 0045): the Foundations the design system has data
 * for and the Guidelines, DESIGN.md's sections, each an item of the board view, and the boards it
 * opens as, generated documents the canvas's renderer draws. Pure: the board view and its list
 * read them, the tests too.
 *
 * Color's boards are `color-boards.ts`'s, the other foundations' `foundation-boards.ts`'s; a
 * guideline is its section as a readable document. A node a board draws for something that can be
 * picked is named for it (`token:color-primary-600`, `style:Body`, `group:primary`), so a click on
 * it picks that (B6).
 */
import type {
  DesignDocument,
  DesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { NEUTRAL_COLORS } from "@ultrapaint/system-components/look";
import { found, sheet, tokensFound } from "./board-nodes.ts";
import { colorBoards } from "./color-boards.ts";
import { foundationBoards } from "./foundation-boards.ts";

/** A board of an item: a generated document drawn as a frame, named within the item. */
export interface Board {
  /** A stylesheet of its own, for what a document cannot say: an easing's animation (B12). */
  readonly css?: string;
  /**
   * An app component's instance it draws, whose tree a double-click edits in place there, the
   * edits landing on the member it is drawn with (its own fields for none).
   */
  readonly inPlace?: {
    readonly instance: InstanceNode;
    readonly variant: {
      readonly member: string;
      readonly property: string;
    } | null;
  };
  /** Unique within the item: the last part of its frame id. */
  readonly name: string;
  readonly root: DesignNode;
  /** The theme it is drawn in whatever the tools' switch says: Color's, one board a theme. */
  readonly theme?: string;
  /** Over its frame, beside the item's name. */
  readonly title: string;
}

/** An item's boards, and whether they are laid out side by side, one under the other, or side by side as far as the canvas holds. */
export interface Boards {
  readonly boards: readonly Board[];
  readonly direction: "row" | "column" | "wrap";
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
    const count = NEUTRAL_COLORS.filter((c) =>
      found({ name: c.name, value: "" }, q)
    ).length;
    return count > 0 || !q ? [{ count, id: "color", name: "Color" }] : [];
  }
  return FOUNDATIONS.flatMap((f) => {
    const count = tokensFound(ds, f.kinds, q).length + extrasOf(ds, f.id, q);
    // The spacing base is always there: a design system always has spacing.
    const shown = count > 0 || (f.id === "spacing" && !q);
    return shown ? [{ count, id: f.id, name: f.name }] : [];
  });
};

const GUIDE_PREFIX = "guide-";
const BLANK_LINE = /\n\s*\n/;
const NOT_WORD = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-|-$/g;

/** Whether an item of Design system is a guideline, by its id. */
export const isGuideline = (item: string) => item.startsWith(GUIDE_PREFIX);

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

const HEADING_RE = /^(#{3,6})\s+(.*)$/;
const LINE_BREAK = /\n/;

/**
 * A section's markdown as the nodes of a readable document: a paragraph per block, a `###`
 * heading as a heading, a list's lines as they are.
 */
const proseNodes = (markdown: string): DesignNode[] =>
  markdown
    .split(BLANK_LINE)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((block, i): DesignNode => {
      const heading: RegExpExecArray | null = HEADING_RE.exec(block);
      if (heading && !LINE_BREAK.test(block)) {
        return {
          id: `paragraph-${i}`,
          level: Math.min(6, (heading[1] ?? "###").length),
          role: "heading",
          text: heading[2] ?? "",
          type: "text",
        };
      }
      return {
        id: `paragraph-${i}`,
        lineHeight: 1.6,
        role: "paragraph",
        size: 15,
        text: block,
        type: "text",
        width: "fill",
      };
    });

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
  const paragraphs = proseNodes(section.text);
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
          560
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
  if (isGuideline(item)) {
    return guidelineBoards(document, item);
  }
  return ds
    ? foundationBoards(item, ds, q)
    : { boards: [], direction: "column" };
};
