/**
 * Design system's Color (ADR 0045): a board per theme, side by side, each drawn in its theme.
 * Every palette is its ramp, 50 to 950, each shade over its step; a group that is no ramp (the
 * semantic colours) its swatches, each with its name and its value in the theme; and under them
 * the usual pairs of a foreground on its background with their WCAG contrast ratio and grade. A swatch is named for its token and a
 * group's title for the group, so a click picks one. Pure.
 */
import type {
  DesignSystem,
  TokenGroup,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { themesOf, valueInTheme } from "@ultrapaint/contracts/themes";
import { shortName } from "@ultrapaint/contracts/token-table";
import {
  contrastRatio,
  hexOf,
  parseColor,
} from "@ultrapaint/contracts/token-value";
import { shadeOf } from "@ultrapaint/design-document/ramp";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import {
  code,
  label,
  nameText,
  RULE,
  ruled,
  sheet,
  text,
  WELL,
} from "./board-nodes.ts";
import { pickId } from "./pick.ts";
import type { Board, Boards } from "./system-boards.ts";

/** Whether a group is a palette's ramp: three shades or more, every one of them a step. */
export const isRamp = (group: Pick<TokenGroup, "tokens">): boolean =>
  group.tokens.length >= 3 && group.tokens.every((t) => shadeOf(t.name));

/** The board's width: three swatches a row. */
const BOARD_WIDTH = 540;
/** A swatch's width: a third of the board's row, less its gaps. */
const SWATCH = 148;

const REFERENCE = /^var\(--([\w-]+)\)$/;

/**
 * A colour's value as a swatch says it in a theme: another token it names, by its short name, or
 * the colour it comes to, in hex.
 */
const shownValue = (ds: DesignSystem, name: string, theme: string): string => {
  const own = valueInTheme(ds, name, theme)?.trim() ?? "";
  if (REFERENCE.test(own)) {
    // `var(--color-blue-500)`: the name between `var(--` and `)`.
    return `→ ${shortName(own.slice("var(--".length, -1))}`;
  }
  const followed = valueInTheme(ds, name, theme, { follow: true });
  const color = followed ? parseColor(followed) : null;
  return color ? hexOf(color) : own;
};

/** A shade of a ramp: an even share of the row, its step under it, named for its token. */
const shade = (name: string): DesignNode => ({
  children: [
    {
      border: { color: RULE, width: 1 },
      children: [],
      fill: tokenRef(name),
      height: 40,
      id: `fill:${name}`,
      radius: 6,
      type: "group",
      width: "fill",
    },
    code(`step:${name}`, String(shadeOf(name)?.step ?? shortName(name)), 10.5, {
      align: "center",
      width: "fill",
    }),
  ],
  gap: 6,
  id: pickId({ kind: "token", name }),
  type: "column",
  width: "fill",
});

/** A colour that is no step: its fill, then its name and its value in the board's theme. */
const swatch = (ds: DesignSystem, name: string, theme: string): DesignNode => ({
  children: [
    {
      border: { color: RULE, width: 1 },
      children: [],
      fill: tokenRef(name),
      height: 56,
      id: `fill:${name}`,
      radius: 8,
      type: "group",
      width: "fill",
    },
    {
      children: [
        label(`name:${name}`, shortName(name), 12, {
          color: "currentColor",
          weight: 500,
          width: "fill",
        }),
        code(`value:${name}`, shownValue(ds, name, theme), 11),
      ],
      id: `about:${name}`,
      type: "column",
      width: "fill",
    },
  ],
  gap: 8,
  id: pickId({ kind: "token", name }),
  type: "column",
  width: SWATCH,
});

/** A group: its title, then its ramp, every shade over its step, or its swatches. */
const groupNode = (
  ds: DesignSystem,
  group: TokenGroup,
  names: readonly string[],
  theme: string
): DesignNode => {
  const title = nameText(
    pickId({ kind: "group", name: group.name }),
    group.name,
    14,
    {
      weight: 600,
    }
  );
  if (isRamp(group)) {
    return {
      children: [
        title,
        {
          children: names.map(shade),
          gap: 4,
          id: `ramp:${group.name}`,
          type: "row",
          width: "fill",
        },
      ],
      gap: 12,
      id: `palette:${group.name}`,
      type: "column",
      width: "fill",
    };
  }
  return {
    children: [
      title,
      {
        children: names.map((n) => swatch(ds, n, theme)),
        gap: 16,
        id: `swatches:${group.name}`,
        type: "row",
        width: "fill",
        wrap: true,
      },
    ],
    gap: 12,
    id: `palette:${group.name}`,
    type: "column",
    width: "fill",
  };
};

/** WCAG's grade for a contrast ratio: what text it passes for. */
export const gradeOf = (ratio: number): "AAA" | "AA" | "AA large" | "Fails" => {
  if (ratio >= 7) {
    return "AAA";
  }
  if (ratio >= 4.5) {
    return "AA";
  }
  return ratio >= 3 ? "AA large" : "Fails";
};

/**
 * The usual pairs of a foreground on its background the design system has both of: the text
 * and the muted text on the background, each `<name>-foreground` on its `<name>`, the muted text
 * on the muted surface.
 */
export const contrastPairs = (
  names: ReadonlySet<string>
): (readonly [string, string])[] => {
  const pairs: (readonly [string, string])[] = [
    ["color-foreground", "color-background"],
    ["color-muted-foreground", "color-background"],
  ];
  for (const name of names) {
    const fg = `${name}-foreground`;
    if (name !== "color-background" && names.has(fg)) {
      pairs.push([fg, name]);
    }
  }
  pairs.push(["color-muted-foreground", "color-muted"]);
  const seen = new Set<string>();
  return pairs.filter(([fg, bg]) => {
    const key = `${fg} ${bg}`;
    const fresh = names.has(fg) && names.has(bg) && !seen.has(key);
    seen.add(key);
    return fresh;
  });
};

/** The dot beside a grade: passing, passing for large text only, failing. */
const GRADE_DOTS: Readonly<Record<ReturnType<typeof gradeOf>, string>> = {
  AA: "#22a35a",
  "AA large": "#d99a12",
  AAA: "#22a35a",
  Fails: "#e5484d",
};

/**
 * A pair: the background with "Aa" in the foreground, their names, the ratio, and its grade in
 * a neutral badge with a dot that says whether it passes.
 */
const pairNode = (
  ds: DesignSystem,
  [fg, bg]: readonly [string, string],
  theme: string
): DesignNode | null => {
  const a = valueInTheme(ds, fg, theme, { follow: true });
  const b = valueInTheme(ds, bg, theme, { follow: true });
  const ratio = a && b ? contrastRatio(a, b) : null;
  if (ratio === null) {
    return null;
  }
  const grade = gradeOf(ratio);
  const id = `${fg}:${bg}`;
  return {
    children: [
      {
        align: "center",
        border: { color: RULE, width: 1 },
        children: [
          text(`aa:${id}`, "Aa", 13, { color: tokenRef(fg), weight: 600 }),
        ],
        crossAlign: "center",
        fill: tokenRef(bg),
        height: 32,
        id: `tile:${id}`,
        radius: 6,
        type: "row",
        width: 32,
      },
      {
        children: [
          label(`fg:${id}`, shortName(fg), 12, {
            color: "currentColor",
            weight: 500,
          }),
          label(`bg:${id}`, `on ${shortName(bg)}`, 12),
        ],
        id: `names:${id}`,
        type: "column",
        width: "fill",
      },
      code(`ratio:${id}`, `${ratio.toFixed(1)}:1`, 12, {
        color: "currentColor",
      }),
      {
        children: [
          {
            children: [],
            fill: GRADE_DOTS[grade],
            height: 6,
            id: `dot:${id}`,
            radius: 3,
            type: "group",
            width: 6,
          },
          label(`grade:${id}`, grade, 11, {
            color: "currentColor",
            weight: 500,
          }),
        ],
        crossAlign: "center",
        fill: WELL,
        gap: 6,
        id: `chip:${id}`,
        padding: { bottom: 2, left: 8, right: 8, top: 2 },
        radius: 999,
        type: "row",
        width: 84,
      },
    ],
    crossAlign: "center",
    gap: 12,
    id: `pair:${id}`,
    type: "row",
    width: "fill",
  };
};

/** A theme's board: every group, then the contrast pairs. */
const themeBoard = (
  ds: DesignSystem,
  theme: string,
  groups: readonly { group: TokenGroup; names: readonly string[] }[]
): DesignNode => {
  const names = new Set(ds.colors.flatMap((g) => g.tokens.map((t) => t.name)));
  const pairs = contrastPairs(names).flatMap((pair) => {
    const node = pairNode(ds, pair, theme);
    return node ? [node] : [];
  });
  return sheet(
    `colors-${theme}`,
    [
      ...groups.map((g) => groupNode(ds, g.group, g.names, theme)),
      ...(pairs.length > 0
        ? [
            {
              children: [
                nameText("contrast-title", "Contrast", 14, { weight: 600 }),
                ...ruled(pairs, 8),
              ],
              gap: 12,
              id: "contrast",
              type: "column" as const,
              width: "fill" as const,
            },
          ]
        : []),
    ],
    BOARD_WIDTH,
    40
  );
};

/**
 * Color's boards: one per theme of the design system, side by side, each drawn in its theme. A
 * search keeps the colours whose name or value has it.
 */
export const colorBoards = (ds: DesignSystem, q: string): Boards => {
  const themes = themesOf(ds);
  const boards = themes.map((theme): Board => {
    // The palettes first, as ramps, then the colours named for what they do.
    const ordered = [
      ...ds.colors.filter((g) => isRamp(g)),
      ...ds.colors.filter((g) => !isRamp(g)),
    ];
    const groups = ordered
      .map((group) => ({
        group,
        names: group.tokens
          .filter((t) => {
            const value =
              valueInTheme(ds, t.name, theme, { follow: true }) ?? "";
            return (
              !q ||
              t.name.toLowerCase().includes(q) ||
              value.toLowerCase().includes(q)
            );
          })
          .map((t) => t.name),
      }))
      .filter((g) => g.names.length > 0 || (!q && g.group.tokens.length === 0));
    const name = theme.toLowerCase();
    return {
      name,
      root: themeBoard(ds, theme, groups),
      theme,
      title: theme.charAt(0).toUpperCase() + theme.slice(1),
    };
  });
  return { boards, direction: "row" };
};
