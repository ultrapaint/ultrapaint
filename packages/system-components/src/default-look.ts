/**
 * The default look (ADR 0062): what a project with no design system of its own is drawn in,
 * written as a design system so the Design system place shows it like any other, and agents read
 * it as tokens. Its values are the ones the system components draw with before a design says
 * otherwise (`look.ts`): the neutral palette in light and dark, the system's sans, Tailwind's
 * scales, three radii, three levels and Lucide's icons.
 */
import {
  type DesignSystem,
  starterTextStyles,
  type Token,
} from "@ultrapaint/contracts/design-system";
import { NEUTRAL_COLORS, NEUTRAL_SHADOWS } from "./look.ts";

const token = (name: string, value: string, description?: string): Token => ({
  ...(description === undefined ? {} : { description }),
  name,
  value,
});

/** What each neutral role is for, as the Color board says it. */
const ROLES: Readonly<Record<string, string>> = {
  "color-accent": "Hovered rows and items",
  "color-background": "The page",
  "color-border": "Rules and the edges of cards",
  "color-card": "Cards and panels",
  "color-destructive": "Deleting and errors",
  "color-foreground": "Text",
  "color-input": "The edges of fields",
  "color-muted": "Quiet fills",
  "color-muted-foreground": "Secondary text",
  "color-popover": "Menus and popovers",
  "color-primary": "The main action",
  "color-ring": "The focus ring",
  "color-secondary": "Secondary actions",
};

const fonts = [
  token(
    "font-sans",
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    "Every text: the system's own sans"
  ),
  token(
    "font-mono",
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    "Code and figures set in columns"
  ),
];

const sizes = [
  { ...token("text-xs", "0.75rem"), lineHeight: "1rem" },
  { ...token("text-sm", "0.875rem"), lineHeight: "1.25rem" },
  { ...token("text-base", "1rem"), lineHeight: "1.5rem" },
  { ...token("text-lg", "1.125rem"), lineHeight: "1.75rem" },
  { ...token("text-xl", "1.25rem"), lineHeight: "1.75rem" },
  { ...token("text-2xl", "1.5rem"), lineHeight: "2rem" },
  { ...token("text-3xl", "1.875rem"), lineHeight: "2.25rem" },
  { ...token("text-4xl", "2.25rem"), lineHeight: "2.5rem" },
];

const weights = [
  token("font-weight-normal", "400"),
  token("font-weight-medium", "500"),
  token("font-weight-semibold", "600"),
  token("font-weight-bold", "700"),
];

const leading = [
  token("leading-tight", "1.25"),
  token("leading-snug", "1.375"),
  token("leading-normal", "1.5"),
  token("leading-relaxed", "1.625"),
];

/** What each shadow is for, as the Elevation board says it. */
const LEVELS: Readonly<Record<string, string>> = {
  "shadow-lg": "Menus, popovers and dialogs",
  "shadow-md": "What floats over the page: a dragged item",
  "shadow-sm": "Raised cards",
};

const shadows = NEUTRAL_SHADOWS.map((s) =>
  token(s.name, s.value, LEVELS[s.name])
);

export const DEFAULT_LOOK: DesignSystem = {
  colors: [
    {
      name: "Semantic",
      tokens: NEUTRAL_COLORS.map((c) => ({
        ...token(c.name, c.light, ROLES[c.name]),
        values: { dark: c.dark },
      })),
    },
  ],
  elevation: [
    {
      description: "The page and what sits flat on it",
      name: "Default",
      surface: "$color-background",
    },
    {
      description: "Cards and panels",
      name: "Raised",
      shadow: "$shadow-sm",
      surface: "$color-card",
    },
    {
      description: "Menus, popovers and dialogs",
      layer: 50,
      name: "Overlay",
      shadow: "$shadow-lg",
      surface: "$color-popover",
    },
  ],
  icons: {
    description:
      "Lucide at a 2px stroke, beside a label wherever there is room for one",
    from: "lucide-react",
    sizes: [16, 20],
    stroke: 2,
  },
  radius: [
    token("radius-sm", "0.375rem", "Items inside menus and lists"),
    token("radius-md", "0.5rem", "Buttons, fields and popovers"),
    token("radius-lg", "0.75rem", "Cards and dialogs"),
  ],
  shadows,
  spacing: { base: "0.25rem" },
  themes: ["light", "dark"],
  typography: {
    fonts,
    leading,
    sizes,
    styles: starterTextStyles({ fonts, leading, sizes, weights }),
    weights,
  },
  version: 1,
};
