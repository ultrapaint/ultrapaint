/**
 * Design system's Color (ADR 0045): a board per theme, side by side, each drawn in its theme.
 * Every palette is its ramp, 50 to 950, over a gradient strip; a group that is no ramp (the
 * semantic colours) its named swatches; and under them the usual pairs of a foreground on its
 * background with their WCAG contrast ratio and grade. A swatch is named for its token and a
 * group's title for the group, so a click picks one. Pure.
 */
import {
  type DesignSystem,
  emptyDesignSystem,
  type TokenGroup,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { shortName } from "@ultrapaint/contracts/token-table";
import { contrastRatio } from "@ultrapaint/contracts/token-value";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import { NEUTRAL_COLORS } from "@ultrapaint/system-components/look";
import { isDark, label, MONO, sheet, text, valueIn } from "./board-nodes.ts";
import { pickId } from "./pick.ts";
import type { Board, Boards } from "./system-boards.ts";

/**
 * The neutral palette every design draws with until it has a design system, as one: light and
 * dark, the way `system-components/look` writes it.
 */
const neutralDesignSystem = (): DesignSystem => ({
  ...emptyDesignSystem(),
  colors: [
    {
      name: "neutral",
      tokens: NEUTRAL_COLORS.map((c) => ({
        name: c.name,
        value: c.light,
        values: { dark: c.dark },
      })),
    },
  ],
  themes: ["light", "dark"],
});

const STEP_RE = /-(\d+)$/;

/** A palette's step from its token's name: `color-primary-600` is 600. */
export const stepOf = (name: string): number | null => {
  const step: RegExpExecArray | null = STEP_RE.exec(name);
  const found = step?.[1];
  return found === undefined ? null : Number(found);
};

/** Whether a group is a palette's ramp: three shades or more, every one of them a step. */
export const isRamp = (group: Pick<TokenGroup, "tokens">): boolean =>
  group.tokens.length >= 3 &&
  group.tokens.every((t) => {
    const step = stepOf(t.name);
    return step !== null && step >= 0 && step <= 1000;
  });

const edge = (dark: boolean) => (dark ? "#ffffff1f" : "#0000001a");

/** A shade of a ramp: an even share of the row, named for its token. */
const shade = (name: string, dark: boolean): DesignNode => ({
  border: { color: edge(dark), width: 1 },
  children: [],
  fill: tokenRef(name),
  height: 28,
  id: pickId({ kind: "token", name }),
  radius: 4,
  type: "group",
  width: "fill",
});

/** A swatch's width: four to a row of the board. */
const SWATCH = 52;

/** A colour that is no step, with its name under it. */
const swatch = (name: string, dark: boolean): DesignNode => ({
  children: [
    {
      border: { color: edge(dark), width: 1 },
      children: [],
      fill: tokenRef(name),
      height: 36,
      id: `fill:${name}`,
      radius: 6,
      type: "group",
      width: SWATCH,
    },
    label(`name:${name}`, shortName(name), 10),
  ],
  gap: 4,
  id: pickId({ kind: "token", name }),
  type: "column",
  width: SWATCH,
});

/** A group: its title, then its ramp over a gradient strip, or its swatches. */
const groupNode = (
  group: TokenGroup,
  names: readonly string[],
  dark: boolean
): DesignNode => {
  const title = label(
    pickId({ kind: "group", name: group.name }),
    group.name,
    11
  );
  if (isRamp(group)) {
    return {
      children: [
        title,
        {
          children: names.map((n) => shade(n, dark)),
          gap: 3,
          id: `ramp:${group.name}`,
          type: "row",
          width: "fill",
        },
        {
          children: [],
          fill: `linear-gradient(to right, ${group.tokens.map((t) => `var(--${t.name})`).join(", ")})`,
          height: 5,
          id: `strip:${group.name}`,
          radius: 3,
          type: "group",
          width: "fill",
        },
      ],
      gap: 6,
      id: `palette:${group.name}`,
      type: "column",
      width: "fill",
    };
  }
  return {
    children: [
      title,
      {
        children: names.map((n) => swatch(n, dark)),
        gap: 8,
        id: `swatches:${group.name}`,
        type: "row",
        width: "fill",
        wrap: true,
      },
    ],
    gap: 6,
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

const GRADE_COLORS: Readonly<
  Record<ReturnType<typeof gradeOf>, readonly [string, string, string, string]>
> = {
  // Light fill, light text, dark fill, dark text.
  AA: ["#dcfce7", "#166534", "#14532d", "#bbf7d0"],
  "AA large": ["#fef3c7", "#92400e", "#78350f", "#fde68a"],
  AAA: ["#dcfce7", "#166534", "#14532d", "#bbf7d0"],
  Fails: ["#fee2e2", "#991b1b", "#7f1d1d", "#fecaca"],
};

/** A pair: the background with "Aa" in the foreground, their names, the ratio and its grade. */
const pairNode = (
  ds: DesignSystem,
  [fg, bg]: readonly [string, string],
  theme: string
): DesignNode | null => {
  const a = valueIn(ds, fg, theme);
  const b = valueIn(ds, bg, theme);
  const ratio = a && b ? contrastRatio(a, b) : null;
  if (ratio === null) {
    return null;
  }
  const grade = gradeOf(ratio);
  const dark = isDark(theme);
  const [fill, color] = dark
    ? [GRADE_COLORS[grade][2], GRADE_COLORS[grade][3]]
    : [GRADE_COLORS[grade][0], GRADE_COLORS[grade][1]];
  const id = `${fg}:${bg}`;
  return {
    children: [
      {
        align: "center",
        border: { color: edge(dark), width: 1 },
        children: [
          text(`aa:${id}`, "Aa", 12, { color: tokenRef(fg), weight: 600 }),
        ],
        crossAlign: "center",
        fill: tokenRef(bg),
        height: 30,
        id: `tile:${id}`,
        radius: 6,
        type: "row",
        width: 30,
      },
      {
        children: [
          text(`fg:${id}`, shortName(fg), 12),
          label(`bg:${id}`, `on ${shortName(bg)}`, 11),
        ],
        id: `names:${id}`,
        type: "column",
        width: "fill",
      },
      text(`ratio:${id}`, ratio.toFixed(1), 12, { font: MONO }),
      {
        align: "center",
        children: [text(`grade:${id}`, grade, 10, { color, weight: 600 })],
        fill,
        id: `chip:${id}`,
        padding: { bottom: 2, top: 2 },
        radius: 999,
        type: "row",
        width: 52,
      },
    ],
    crossAlign: "center",
    gap: 8,
    id: `pair:${id}`,
    type: "row",
    width: "fill",
  };
};

const BOARD_WIDTH = 290;

/** A theme's board: the steps' scale, every group, the contrast pairs. */
const themeBoard = (
  ds: DesignSystem,
  theme: string,
  groups: readonly { group: TokenGroup; names: readonly string[] }[]
): DesignNode => {
  const dark = isDark(theme);
  const ramps = groups.some((g) => isRamp(g.group));
  const names = new Set(ds.colors.flatMap((g) => g.tokens.map((t) => t.name)));
  const pairs = contrastPairs(names).flatMap((pair) => {
    const node = pairNode(ds, pair, theme);
    return node ? [node] : [];
  });
  return sheet(
    `colors-${theme}`,
    [
      ...(ramps
        ? [
            {
              align: "between" as const,
              children: ["50", "500", "950"].map((step) =>
                label(`step-${step}`, step, 10, { font: MONO })
              ),
              id: "steps",
              type: "row" as const,
              width: "fill" as const,
            },
          ]
        : []),
      ...groups.map((g) => groupNode(g.group, g.names, dark)),
      ...(pairs.length > 0
        ? [
            {
              border: { color: edge(dark), width: "1px 0 0 0" },
              children: [label("contrast-title", "Contrast", 11), ...pairs],
              gap: 10,
              id: "contrast",
              padding: { top: 16 },
              type: "column" as const,
              width: "fill" as const,
            },
          ]
        : []),
    ],
    BOARD_WIDTH,
    16
  );
};

/**
 * Color's boards: one per theme of the design system, side by side, each drawn in its theme;
 * without a design system, the neutral palette's light and dark. A search keeps the colours whose
 * name or value has it.
 */
export const colorBoards = (given: DesignSystem | null, q: string): Boards => {
  const ds = given ?? neutralDesignSystem();
  const themes = ds.themes && ds.themes.length > 0 ? ds.themes : ["light"];
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
            const value = valueIn(ds, t.name, theme) ?? "";
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
