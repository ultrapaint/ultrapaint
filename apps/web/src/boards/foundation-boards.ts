/**
 * Design system's foundations besides Color (ADR 0045), as boards drawn in the theme the tools'
 * switch picks: Typography (each text style set in itself under its group, the type scale, the
 * families and weights, line heights and tracking), Spacing (the base and its steps as bars, the
 * named spacings), Radius (a tile per radius), Elevation (the levels on their surfaces, the
 * shadows), Motion (each easing and duration animated, B12) and Breakpoints (bars to scale). A
 * token's specimen is named for it and a text style's for the style, so a click picks it. Pure.
 */
import {
  type DesignSystem,
  TEXT_STYLE_GROUPS,
  type TextStyle,
  type Token,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  shortName,
  spacingBasePx,
  tokensOfKind,
} from "@ultrapaint/contracts/token-table";
import { ROOT_PX, toMs, toPx } from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import { isToken, tokenRef } from "@ultrapaint/design-document/tokens";
import { label, MONO, section, sheet, text, tokenRow } from "./board-nodes.ts";
import type { Board, Boards } from "./system-boards.ts";

const SAMPLE = "The quick brown fox jumps over the lazy dog";
const WIDE = 560;
const ACCENT = "#6366f1";
const SURFACE = "#8a8a9326";

const matches = (token: { name: string; value: string }, q: string) =>
  !q ||
  token.name.toLowerCase().includes(q) ||
  token.value.toLowerCase().includes(q);

const tokensOf = (ds: DesignSystem, kind: TokenKind, q: string): Token[] =>
  tokensOfKind(ds, kind).filter((t) => matches(t, q));

/** A board when it has anything to draw. */
const board = (
  name: string,
  title: string,
  children: DesignNode[],
  width = WIDE,
  css?: string
): Board[] =>
  children.length === 0
    ? []
    : [
        {
          name,
          root: sheet(name, children, width, 4),
          title,
          ...(css && { css }),
        },
      ];

/** A style's setting as it reads: a token by its short name, a number as it is. */
const settingOf = (value: string | number | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return isToken(value) ? shortName(value.slice(1)) : String(value);
};

/** A text style: its name and settings over a sample set in it. */
const styleNode = (style: TextStyle): DesignNode => {
  const settings = [style.size, style.weight, style.lineHeight, style.tracking]
    .map(settingOf)
    .filter((s): s is string => s !== undefined);
  return {
    children: [
      {
        children: [
          text(`style-name:${style.name}`, style.name, 12, { weight: 600 }),
          label(
            `style-settings:${style.name}`,
            [style.level ? `h${style.level}` : null, ...settings]
              .filter(Boolean)
              .join(" · "),
            11,
            { font: MONO }
          ),
        ],
        crossAlign: "baseline",
        gap: 10,
        id: `style-head:${style.name}`,
        type: "row",
      },
      {
        id: `style-sample:${style.name}`,
        ...(style.level !== undefined && { level: style.level }),
        role: style.role,
        text: SAMPLE,
        textStyle: style.name,
        type: "text",
        width: "fill",
      },
    ],
    gap: 4,
    id: `style:${style.name}`,
    padding: { bottom: 10, top: 10 },
    type: "column",
    width: "fill",
  };
};

const typographyBoards = (ds: DesignSystem, q: string): Boards => {
  const styles = ds.typography.styles.filter(
    (s) => !q || s.name.toLowerCase().includes(q)
  );
  const grouped = [...groupTextStyles(styles)]
    .filter(([, list]) => list.length > 0)
    .map(([group, list]) =>
      section(
        `styles-${group}`,
        TEXT_STYLE_GROUPS.find((g) => g.group === group)?.label ?? group,
        list.map(styleNode),
        0
      )
    );
  const sizes = tokensOf(ds, "fontSize", q).map((size) =>
    tokenRow(
      size,
      text(`sample:${size.name}`, "Ag", 13, { size: tokenRef(size.name) }),
      96
    )
  );
  const fonts = tokensOf(ds, "font", q).map((font) => ({
    children: [
      label(`font-name:${font.name}`, `${font.name} · ${font.value}`, 11, {
        font: MONO,
      }),
      text(
        `font-sample:${font.name}`,
        "Aa Bb Cc 0123 — The quick brown fox",
        22,
        {
          font: tokenRef(font.name),
        }
      ),
    ],
    gap: 4,
    id: `token:${font.name}`,
    padding: { bottom: 8, top: 8 },
    type: "column" as const,
    width: "fill" as const,
  }));
  const weights = tokensOf(ds, "fontWeight", q).map((weight) =>
    tokenRow(
      weight,
      text(`sample:${weight.name}`, "Ag", 18, { weight: tokenRef(weight.name) })
    )
  );
  const spacing = [
    ...tokensOf(ds, "leading", q).map((t) =>
      tokenRow(t, label(`sample:${t.name}`, "≡", 16))
    ),
    ...tokensOf(ds, "tracking", q).map((t) =>
      tokenRow(
        t,
        text(`sample:${t.name}`, "AV", 15, { tracking: tokenRef(t.name) })
      )
    ),
  ];
  return {
    boards: [
      ...board("styles", "Text styles", grouped),
      ...board("scale", "Type scale", sizes),
      ...board("families", "Families and weights", [...fonts, ...weights]),
      ...board("leading", "Line height and tracking", spacing),
    ],
    direction: "column",
  };
};

/** A length as pixels, an `em` at the root's size; 0 when it is none. */
const pxOf = (value: string) => toPx(value, { em: ROOT_PX }) ?? 0;

const bar = (id: string, width: number, height = 10): DesignNode => ({
  children: [],
  fill: ACCENT,
  height,
  id,
  radius: 2,
  type: "group",
  width: Math.max(2, Math.round(width)),
});

/** The steps of the spacing scale drawn beside the base: a few, as the old panel had. */
const SPACING_SAMPLE = [1, 2, 3, 4, 6, 8, 12, 16];

const spacingBoards = (ds: DesignSystem, q: string): Boards => {
  const base = spacingBasePx(ds.spacing.base);
  const showBase =
    !q || "spacing".includes(q) || ds.spacing.base.toLowerCase().includes(q);
  const steps = showBase
    ? [
        tokenRow(
          {
            description: "The step every spacing multiplies",
            name: "spacing",
            value: ds.spacing.base,
          },
          bar("bar:spacing", base),
          88,
          "start"
        ),
        ...SPACING_SAMPLE.map(
          (step): DesignNode => ({
            children: [
              label(`step-name-${step}`, `${step} · ${step * base}px`, 11, {
                font: MONO,
                width: 88,
              }),
              bar(`step-bar-${step}`, step * base),
            ],
            crossAlign: "center",
            gap: 12,
            id: `step-${step}`,
            padding: { bottom: 3, top: 3 },
            type: "row",
            width: "fill",
          })
        ),
      ]
    : [];
  const named = tokensOf(ds, "spacing", q).map((t) =>
    tokenRow(
      t,
      bar(`bar:${t.name}`, Math.min(pxOf(t.value), 240)),
      260,
      "start"
    )
  );
  return {
    boards: [
      ...board("scale", "Scale", steps),
      ...board("named", "Named spacing", named),
    ],
    direction: "column",
  };
};

const radiusBoards = (ds: DesignSystem, q: string): Boards => ({
  boards: board(
    "radii",
    "Radii",
    tokensOf(ds, "radius", q).map((t) =>
      tokenRow(t, {
        border: { color: ACCENT, width: 2 },
        children: [],
        fill: SURFACE,
        height: 48,
        id: `tile:${t.name}`,
        radius: tokenRef(t.name),
        type: "group",
        width: 48,
      })
    ),
    480
  ),
  direction: "column",
});

/** A surface lifted by a shadow, named as it is given: a token or CSS. */
const lifted = (
  id: string,
  surface: string | undefined,
  shadow: string | undefined
): DesignNode => ({
  border: { color: "#8a8a9333", width: 1 },
  children: [],
  fill: surface ?? tokenRef("color-background"),
  height: 44,
  id,
  radius: 8,
  ...(shadow && { shadow }),
  type: "group",
  width: 64,
});

const elevationBoards = (ds: DesignSystem, q: string): Boards => {
  const levels = (ds.elevation ?? [])
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .map(
      (level): DesignNode => ({
        children: [
          {
            align: "center",
            children: [
              lifted(`surface:${level.name}`, level.surface, level.shadow),
            ],
            id: `level-preview:${level.name}`,
            type: "row",
            width: 96,
          },
          {
            children: [
              text(`level-name:${level.name}`, level.name, 13, { weight: 600 }),
              ...(level.description
                ? [label(`level-about:${level.name}`, level.description, 11)]
                : []),
              label(
                `level-values:${level.name}`,
                [level.surface, level.shadow, level.layer && `z-${level.layer}`]
                  .filter(Boolean)
                  .join(" · "),
                11,
                { font: MONO }
              ),
            ],
            gap: 2,
            id: `level-names:${level.name}`,
            type: "column",
            width: "fill",
          },
        ],
        crossAlign: "center",
        gap: 16,
        id: `level:${level.name}`,
        padding: { bottom: 12, top: 12 },
        type: "row",
        width: "fill",
      })
    );
  const shadows = tokensOf(ds, "shadow", q).map((t) =>
    tokenRow(t, lifted(`tile:${t.name}`, undefined, tokenRef(t.name)), 96)
  );
  return {
    boards: [
      ...board("levels", "Levels", levels),
      ...board("shadows", "Shadows", shadows),
    ],
    direction: "column",
  };
};

const TRACK = 200;
const DOT = 14;

/** A track with a dot the board's stylesheet moves along it, named for its token. */
const track = (name: string): DesignNode => ({
  children: [
    {
      children: [],
      fill: ACCENT,
      height: DOT,
      id: `dot:${name}`,
      radius: DOT / 2,
      type: "group",
      width: DOT,
    },
  ],
  fill: SURFACE,
  height: DOT,
  id: `track:${name}`,
  radius: DOT / 2,
  type: "row",
  width: TRACK,
});

const NODE = "data-ed-node";

/**
 * The motion board's stylesheet (B12): one movement along the track, each easing's dot moved by
 * it over a second and a half with its curve, each duration's with the default curve over it.
 */
export const motionCss = (
  easings: readonly Token[],
  durations: readonly Token[]
): string =>
  [
    `@keyframes ed-board-move { from { translate: 0 0; } to { translate: ${TRACK - DOT}px 0; } }`,
    ...easings.map(
      (t) =>
        `[${NODE}="dot:${t.name}"] { animation: ed-board-move 1.5s var(--${t.name}, ${t.value}) infinite alternate; }`
    ),
    ...durations.map(
      (t) =>
        `[${NODE}="dot:${t.name}"] { animation: ed-board-move var(--${t.name}, ${t.value}) ease-in-out infinite alternate; }`
    ),
    "@media (prefers-reduced-motion: reduce) { [data-ed-node^='dot:'] { animation: none; } }",
  ].join("\n");

const motionBoards = (ds: DesignSystem, q: string): Boards => {
  const easings = tokensOf(ds, "easing", q);
  // A duration that does not read as one is not drawn moving.
  const durations = tokensOf(ds, "duration", q);
  const timed = durations.filter((t) => (toMs(t.value) ?? 0) > 0);
  const animations = tokensOf(ds, "animation", q);
  const css = motionCss(easings, timed);
  return {
    boards: [
      ...board(
        "easings",
        "Easings and durations",
        [
          ...easings.map((t) => tokenRow(t, track(t.name), TRACK + 16)),
          ...durations.map((t) =>
            tokenRow(
              t,
              timed.includes(t)
                ? track(t.name)
                : label(`none:${t.name}`, "—", 13),
              TRACK + 16
            )
          ),
        ],
        WIDE,
        css
      ),
      ...board(
        "animations",
        "Animations",
        animations.map((t) => tokenRow(t, label(`sample:${t.name}`, "~", 16)))
      ),
    ],
    direction: "column",
  };
};

const BAR_MAX = 280;

/** Lengths as bars to one scale, the widest the full width. */
const lengthRows = (tokens: readonly Token[]): DesignNode[] => {
  const widest = Math.max(1, ...tokens.map((t) => pxOf(t.value)));
  return tokens.map((t) =>
    tokenRow(
      t,
      bar(`bar:${t.name}`, (pxOf(t.value) / widest) * BAR_MAX, 8),
      BAR_MAX + 8,
      "start"
    )
  );
};

const breakpointBoards = (ds: DesignSystem, q: string): Boards => ({
  boards: [
    ...board(
      "breakpoints",
      "Breakpoints",
      lengthRows(tokensOf(ds, "breakpoint", q))
    ),
    ...board(
      "containers",
      "Containers",
      lengthRows(tokensOf(ds, "container", q))
    ),
  ],
  direction: "column",
});

/** The boards of a foundation besides Color; none for one it does not know. */
export const foundationBoards = (
  item: string,
  ds: DesignSystem,
  q: string
): Boards => {
  switch (item) {
    case "typography":
      return typographyBoards(ds, q);
    case "spacing":
      return spacingBoards(ds, q);
    case "radius":
      return radiusBoards(ds, q);
    case "elevation":
      return elevationBoards(ds, q);
    case "motion":
      return motionBoards(ds, q);
    case "breakpoints":
      return breakpointBoards(ds, q);
    default:
      return { boards: [], direction: "column" };
  }
};
