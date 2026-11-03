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
  tokenOf,
} from "@ultrapaint/contracts/token-table";
import { ROOT_PX, toMs, toPx } from "@ultrapaint/contracts/token-value";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import { isToken, tokenRef } from "@ultrapaint/design-document/tokens";
import {
  code,
  INK,
  label,
  nameText,
  nodeCss,
  pxOf,
  RULE,
  ruled,
  section,
  sheet,
  text,
  tokenRow,
  tokensFound as tokensOf,
  WELL,
  withPx,
} from "./board-nodes.ts";
import { pickId } from "./pick.ts";
import type { Board, Boards } from "./system-boards.ts";

const SAMPLE = "The quick brown fox jumps over the lazy dog";
const WIDE = 640;
/** A specimen's fill: the design's primary colour, faint, else its text colour's. */
const TINT =
  "color-mix(in oklab, var(--color-primary, currentColor) 14%, transparent)";

/** A board when it has anything to draw. */
const board = (
  name: string,
  title: string,
  children: DesignNode[],
  width = WIDE,
  css?: string,
  gap = 0
): Board[] =>
  children.length === 0
    ? []
    : [
        {
          name,
          root: sheet(name, children, width, gap),
          title,
          ...(css && { css }),
        },
      ];

/** A style's setting as the design system has it: a token's value, a number as it is. */
const settingOf = (
  ds: DesignSystem,
  value: string | number | undefined
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isToken(value)) {
    return String(value);
  }
  const named = value.slice(1);
  return tokenOf(ds, named)?.value ?? shortName(named);
};

/** A style's settings as a type specimen says them: `24px / 1.25 · 600 · -0.02em`. */
const settingsText = (ds: DesignSystem, style: TextStyle): string => {
  const size = settingOf(ds, style.size);
  const px = size === undefined ? null : toPx(size, { em: ROOT_PX });
  const sizeText = px === null ? size : `${Math.round(px * 100) / 100}px`;
  const leading = settingOf(ds, style.lineHeight);
  return [
    style.level ? `h${style.level}` : undefined,
    [sizeText, leading].filter(Boolean).join(" / ") || undefined,
    settingOf(ds, style.weight),
    settingOf(ds, style.tracking),
  ]
    .filter(Boolean)
    .join(" · ");
};

/** A text style: its name and settings beside a sample set in it. */
const styleNode = (ds: DesignSystem, style: TextStyle): DesignNode => ({
  children: [
    {
      children: [
        nameText(`style-name:${style.name}`, style.name, 13, { weight: 600 }),
        code(`style-settings:${style.name}`, settingsText(ds, style), 11),
      ],
      gap: 2,
      id: `style-head:${style.name}`,
      type: "column",
      width: 200,
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
  crossAlign: "center",
  gap: 24,
  id: pickId({ kind: "style", name: style.name }),
  type: "row",
  width: "fill",
});

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
        ruled(
          list.map((style) => styleNode(ds, style)),
          14
        ),
        8
      )
    );
  const sizes = tokensOf(ds, "fontSize", q).map((size) =>
    tokenRow(
      size,
      text(`sample:${size.name}`, "Aa", 13, { size: tokenRef(size.name) }),
      120,
      "start",
      withPx(size.value)
    )
  );
  const fonts = tokensOf(ds, "font", q).map(
    (font): DesignNode => ({
      children: [
        code(`font-name:${font.name}`, font.name, 12.5, {
          color: "currentColor",
        }),
        code(`font-value:${font.name}`, font.value, 11),
        text(`font-sample:${font.name}`, "Aa Bb Cc Dd Ee Ff 0123456789", 28, {
          font: tokenRef(font.name),
          lineHeight: 1.3,
        }),
        ...(font.description
          ? [label(`font-about:${font.name}`, font.description, 12)]
          : []),
      ],
      gap: 4,
      id: pickId({ kind: "token", name: font.name }),
      type: "column",
      width: "fill",
    })
  );
  const weights = tokensOf(ds, "fontWeight", q).map((weight) =>
    tokenRow(
      weight,
      text(`sample:${weight.name}`, "Aa", 22, {
        weight: tokenRef(weight.name),
      }),
      120,
      "start"
    )
  );
  const spacing = [
    ...tokensOf(ds, "leading", q).map((t) =>
      tokenRow(
        t,
        text(`sample:${t.name}`, "Line one\nLine two", 13, {
          lineHeight: tokenRef(t.name),
        }),
        120,
        "start"
      )
    ),
    ...tokensOf(ds, "tracking", q).map((t) =>
      tokenRow(
        t,
        text(`sample:${t.name}`, "Tracking", 15, {
          tracking: tokenRef(t.name),
        }),
        120,
        "start"
      )
    ),
  ];
  return {
    boards: [
      ...board("styles", "Text styles", grouped, 760, undefined, 40),
      ...board("scale", "Type scale", ruled(sizes)),
      ...board(
        "families",
        "Families and weights",
        ruled([...fonts, ...weights], 16)
      ),
      ...board("leading", "Line height and tracking", ruled(spacing)),
    ],
    direction: "column",
  };
};

const bar = (id: string, width: number, height = 12): DesignNode => ({
  children: [],
  fill: INK,
  height,
  id,
  radius: 3,
  type: "group",
  width: Math.max(2, Math.round(width)),
});

/** The steps of the spacing scale drawn beside the base: a few, as the panel before the boards had. */
const SPACING_SAMPLE = [1, 2, 3, 4, 6, 8, 12, 16];

const spacingBoards = (ds: DesignSystem, q: string): Boards => {
  const base = spacingBasePx(ds.spacing.base);
  const showBase =
    !q || "spacing".includes(q) || ds.spacing.base.toLowerCase().includes(q);
  const steps = showBase
    ? [
        tokenRow(
          {
            description: "Every spacing is a multiple of it.",
            name: "spacing",
            value: ds.spacing.base,
          },
          bar("bar:spacing", base),
          96,
          "start",
          withPx(ds.spacing.base)
        ),
        ...SPACING_SAMPLE.map(
          (step): DesignNode => ({
            children: [
              {
                children: [
                  code(`step-name-${step}`, String(step), 12.5, {
                    color: "currentColor",
                    width: 40,
                  }),
                  code(`step-px-${step}`, `${step * base}px`, 12),
                ],
                crossAlign: "baseline",
                id: `step-names-${step}`,
                type: "row",
                width: 96,
              },
              bar(`step-bar-${step}`, step * base),
            ],
            crossAlign: "center",
            gap: 24,
            id: `step-${step}`,
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
      "start",
      withPx(t.value)
    )
  );
  return {
    boards: [
      ...board("scale", "Scale", ruled(steps, 10)),
      ...board("named", "Named spacing", ruled(named)),
    ],
    direction: "column",
  };
};

/** A radius: a tile drawn with it, its name and value under it. */
const radiusTile = (t: Token): DesignNode => ({
  children: [
    {
      border: { color: INK, width: 1.5 },
      children: [],
      fill: TINT,
      height: 80,
      id: `tile:${t.name}`,
      radius: tokenRef(t.name),
      type: "group",
      width: 80,
    },
    {
      children: [
        code(`name:${t.name}`, t.name, 12, { color: "currentColor" }),
        code(`value:${t.name}`, withPx(t.value), 11),
      ],
      id: `names:${t.name}`,
      type: "column",
      width: "fill",
    },
  ],
  gap: 10,
  id: pickId({ kind: "token", name: t.name }),
  type: "column",
  width: 120,
});

const radiusBoards = (ds: DesignSystem, q: string): Boards => {
  const tiles = tokensOf(ds, "radius", q).map(radiusTile);
  return {
    boards: board(
      "radii",
      "Radii",
      tiles.length === 0
        ? []
        : [
            {
              children: tiles,
              gap: 24,
              id: "tiles",
              type: "row",
              width: "fill",
              wrap: true,
            },
          ]
    ),
    direction: "column",
  };
};

/** A surface lifted by a shadow, named as it is given (a token or CSS), on a well that shows it. */
const lifted = (
  id: string,
  surface: string | undefined,
  shadow: string | undefined
): DesignNode => ({
  align: "center",
  children: [
    {
      border: { color: RULE, width: 1 },
      children: [],
      fill: surface ?? tokenRef("color-background"),
      height: 52,
      id,
      radius: 8,
      ...(shadow && { shadow }),
      type: "group",
      width: 88,
    },
  ],
  crossAlign: "center",
  fill: WELL,
  id: `well:${id}`,
  padding: 20,
  radius: 10,
  type: "row",
  width: 128,
});

const elevationBoards = (ds: DesignSystem, q: string): Boards => {
  const levels = (ds.elevation ?? [])
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .map(
      (level): DesignNode => ({
        children: [
          lifted(`surface:${level.name}`, level.surface, level.shadow),
          {
            children: [
              nameText(`level-name:${level.name}`, level.name, 13, {
                weight: 600,
              }),
              code(
                `level-values:${level.name}`,
                [level.surface, level.shadow, level.layer && `z-${level.layer}`]
                  .filter(Boolean)
                  .join(" · "),
                11.5
              ),
              ...(level.description
                ? [
                    label(`level-about:${level.name}`, level.description, 12, {
                      width: "fill",
                    }),
                  ]
                : []),
            ],
            gap: 2,
            id: `level-names:${level.name}`,
            type: "column",
            width: "fill",
          },
        ],
        crossAlign: "center",
        gap: 24,
        id: `level:${level.name}`,
        type: "row",
        width: "fill",
      })
    );
  const shadows = tokensOf(ds, "shadow", q).map((t) =>
    tokenRow(t, lifted(`tile:${t.name}`, undefined, tokenRef(t.name)), 128)
  );
  return {
    boards: [
      ...board("levels", "Levels", ruled(levels, 16)),
      ...board("shadows", "Shadows", ruled(shadows, 16)),
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
      fill: INK,
      height: DOT,
      id: `dot:${name}`,
      radius: DOT / 2,
      type: "group",
      width: DOT,
    },
  ],
  fill: WELL,
  height: DOT,
  id: `track:${name}`,
  radius: DOT / 2,
  type: "row",
  width: TRACK,
});

/** An animation's specimen: a square its own animation moves, where the design defines it. */
const animated = (name: string): DesignNode => ({
  children: [],
  fill: INK,
  height: 20,
  id: `anim:${name}`,
  radius: 4,
  type: "group",
  width: 20,
});

/**
 * The motion board's stylesheet (B12): one movement along the track, each easing's dot moved by
 * it over a second and a half with its curve, each duration's with the default curve over it,
 * and each animation's square by itself.
 */
const motionCss = (
  easings: readonly Token[],
  durations: readonly Token[],
  animations: readonly Token[] = []
): string =>
  [
    `@keyframes ed-board-move { from { translate: 0 0; } to { translate: ${TRACK - DOT}px 0; } }`,
    ...easings.map(
      (t) =>
        `${nodeCss(`dot:${t.name}`)} { animation: ed-board-move 1.5s var(--${t.name}, ${t.value}) infinite alternate; }`
    ),
    ...durations.map(
      (t) =>
        `${nodeCss(`dot:${t.name}`)} { animation: ed-board-move var(--${t.name}, ${t.value}) ease-in-out infinite alternate; }`
    ),
    ...animations.map(
      (t) =>
        `${nodeCss(`anim:${t.name}`)} { animation: var(--${t.name}, ${t.value}); }`
    ),
    `@media (prefers-reduced-motion: reduce) { ${nodeCss("dot:", "^=")}, ${nodeCss("anim:", "^=")} { animation: none; } }`,
  ].join("\n");

const motionBoards = (ds: DesignSystem, q: string): Boards => {
  const easings = tokensOf(ds, "easing", q);
  // A duration that does not read as one is not drawn moving.
  const durations = tokensOf(ds, "duration", q);
  const timed = durations.filter((t) => (toMs(t.value) ?? 0) > 0);
  const animations = tokensOf(ds, "animation", q);
  return {
    boards: [
      ...board(
        "easings",
        "Easings and durations",
        ruled([
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
        ]),
        WIDE,
        motionCss(easings, timed)
      ),
      ...board(
        "animations",
        "Animations",
        ruled(animations.map((t) => tokenRow(t, animated(t.name), 64))),
        WIDE,
        motionCss([], [], animations)
      ),
    ],
    direction: "column",
  };
};

const BAR_MAX = 280;

/** Lengths as bars to one scale, the widest the full width. */
const lengthRows = (tokens: readonly Token[]): DesignNode[] => {
  const widest = Math.max(1, ...tokens.map((t) => pxOf(t.value)));
  return ruled(
    tokens.map((t) =>
      tokenRow(
        t,
        bar(`bar:${t.name}`, (pxOf(t.value) / widest) * BAR_MAX, 8),
        BAR_MAX + 8,
        "start",
        withPx(t.value)
      )
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
