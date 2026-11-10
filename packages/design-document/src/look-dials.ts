/**
 * A look made by choosing (ADR 0062): the look page's dials, the presets that set them all at
 * once, and the design system they come to. The dials are the ones every design leaves open (ADR
 * 0050): the brand colour, how warm the greys are, the corners, the density, how surfaces stand
 * apart, the typeface. What they write is an ordinary design system, in light and dark, which the
 * person can change like any other once it is made. Pure.
 */
import {
  type DesignSystem,
  starterTextStyles,
  type Token,
} from "@ultrapaint/contracts/design-system";
import type { TokenPreset } from "@ultrapaint/contracts/token-presets";
import {
  contrastRatio,
  parseColor,
  toOklch,
} from "@ultrapaint/contracts/token-value";

export type Greys = "warm" | "neutral" | "cool";
export type Corners = "sharp" | "soft" | "round";
export type Density = "compact" | "regular" | "open";
export type Surfaces = "flat" | "borders" | "shadows";
export type IconStroke = "light" | "regular" | "bold";

export interface LookDials {
  /** The brand colour, any CSS colour: the main action, the selection, the focus ring. */
  readonly brand: string;
  readonly corners: Corners;
  readonly density: Density;
  readonly greys: Greys;
  readonly iconStroke: IconStroke;
  readonly surfaces: Surfaces;
  /** How the colours are named: shadcn's roles, or tokens by property and meaning. */
  readonly tokens: TokenPreset;
  /** One of `TYPEFACES`, by its name. */
  readonly typeface: string;
}

/** Lucide's stroke on its 24px grid, for each weight the page offers. */
const ICON_STROKES: Record<IconStroke, number> = {
  bold: 2.5,
  light: 1.5,
  regular: 2,
};

/** A typeface the look page offers: its stack, and the stylesheet that loads it. */
interface Typeface {
  readonly name: string;
  readonly source: string;
  readonly stack: string;
}

const googleFont = (family: string) =>
  `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@400;500;600;700&display=swap`;

const typeface = (name: string, fallback = "sans-serif"): Typeface => ({
  name,
  source: googleFont(name),
  stack: `"${name}", ui-sans-serif, system-ui, ${fallback}`,
});

/** Sans faces with real weights, loaded from Google Fonts; Inter first, as the skill falls back to it. */
export const TYPEFACES: readonly Typeface[] = [
  typeface("Inter"),
  typeface("Geist"),
  typeface("Figtree"),
  typeface("Manrope"),
  typeface("IBM Plex Sans"),
  typeface("Nunito"),
];

interface LookPreset {
  readonly dials: LookDials;
  readonly name: string;
}

/** Where a look starts from: a few characters, each every dial set. */
export const LOOK_PRESETS: readonly LookPreset[] = [
  {
    dials: {
      brand: "#1f7a52",
      corners: "soft",
      density: "regular",
      greys: "warm",
      iconStroke: "regular",
      surfaces: "borders",
      tokens: "simple",
      typeface: "Figtree",
    },
    name: "Calm",
  },
  {
    dials: {
      brand: "#9a3412",
      corners: "sharp",
      density: "open",
      greys: "warm",
      iconStroke: "light",
      surfaces: "flat",
      tokens: "simple",
      typeface: "IBM Plex Sans",
    },
    name: "Notebook",
  },
  {
    dials: {
      brand: "#7c3aed",
      corners: "round",
      density: "regular",
      greys: "neutral",
      iconStroke: "bold",
      surfaces: "shadows",
      tokens: "simple",
      typeface: "Nunito",
    },
    name: "Playful",
  },
  {
    dials: {
      brand: "#2563eb",
      corners: "sharp",
      density: "compact",
      greys: "cool",
      iconStroke: "regular",
      surfaces: "borders",
      tokens: "simple",
      typeface: "Inter",
    },
    name: "Crisp",
  },
];

/** The preset these dials are, if they are one. */
export const presetOf = (dials: LookDials): LookPreset | undefined =>
  LOOK_PRESETS.find((p) =>
    (Object.keys(p.dials) as (keyof LookDials)[])
      // How the colours are named is not a look's: any preset is written either way.
      .filter((k) => k !== "tokens")
      .every((k) => p.dials[k].toLowerCase() === dials[k].toLowerCase())
  );

/** How each family of greys leans: its hue, and how much of it. */
const GREYS: Record<Greys, { readonly chroma: number; readonly hue: number }> =
  {
    cool: { chroma: 0.012, hue: 255 },
    neutral: { chroma: 0, hue: 0 },
    warm: { chroma: 0.007, hue: 70 },
  };

const RADII: Record<Corners, readonly [string, string, string]> = {
  round: ["0.5rem", "0.75rem", "1rem"],
  sharp: ["0.125rem", "0.25rem", "0.375rem"],
  soft: ["0.375rem", "0.5rem", "0.75rem"],
};

/** The spacing step, and how many pixels a body text takes, by density. */
const DENSITY: Record<
  Density,
  { readonly body: string; readonly spacing: string }
> = {
  compact: { body: "0.9375rem", spacing: "0.225rem" },
  open: { body: "1.0625rem", spacing: "0.275rem" },
  regular: { body: "1rem", spacing: "0.25rem" },
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A grey of the family at a lightness. */
const greyOf = (greys: Greys) => (lightness: number) => {
  const { chroma, hue } = GREYS[greys];
  return `oklch(${lightness} ${chroma} ${hue})`;
};

/** The brand as it reads on a dark background: as light as it needs to be, its hue kept. */
const onDark = (brand: string): string => {
  const parsed = parseColor(brand);
  if (!parsed) {
    return brand;
  }
  const [l, c, h] = toOklch(parsed);
  return l >= 0.62
    ? brand
    : `oklch(0.7 ${round3(Math.min(c, 0.2))} ${round3(h)})`;
};

/** Whichever of the two inks reads better on `fill`. */
const inkOn = (fill: string, light: string, dark: string) =>
  (contrastRatio(light, fill) ?? 0) >= (contrastRatio(dark, fill) ?? 0)
    ? light
    : dark;

const token = (
  name: string,
  value: string,
  dark?: string,
  description?: string
): Token => ({
  ...(description === undefined ? {} : { description }),
  name,
  value,
  ...(dark === undefined || dark === value ? {} : { values: { dark } }),
});

/** The semantic colours, in light and dark. */
const colorsOf = (dials: LookDials): Token[] => {
  const g = greyOf(dials.greys);
  const flat = dials.surfaces === "flat";
  const background = { dark: g(0.17), light: g(flat ? 1 : 0.985) };
  const card = flat ? background : { dark: g(0.21), light: g(1) };
  const darkBrand = onDark(dials.brand);
  const white = "oklch(1 0 0)";
  return [
    token("color-background", background.light, background.dark, "The page"),
    token("color-foreground", g(0.18), g(0.97), "Text"),
    token("color-card", card.light, card.dark, "Cards and panels"),
    token("color-card-foreground", g(0.18), g(0.97)),
    token("color-popover", g(1), g(0.23), "Menus and popovers"),
    token("color-popover-foreground", g(0.18), g(0.97)),
    token("color-primary", dials.brand, darkBrand, "The main action"),
    token(
      "color-primary-foreground",
      inkOn(dials.brand, white, g(0.18)),
      inkOn(darkBrand, white, g(0.17))
    ),
    token("color-secondary", g(0.955), g(0.27), "Secondary actions"),
    token("color-secondary-foreground", g(0.2), g(0.97)),
    token("color-muted", g(0.955), g(0.26), "Quiet fills"),
    token("color-muted-foreground", g(0.5), g(0.71), "Secondary text"),
    token("color-accent", g(0.95), g(0.28), "Hovered rows and items"),
    token("color-accent-foreground", g(0.2), g(0.97)),
    token(
      "color-destructive",
      "oklch(0.577 0.215 27)",
      "oklch(0.68 0.19 25)",
      "Deleting and errors"
    ),
    token("color-destructive-foreground", white),
    token(
      "color-border",
      g(dials.surfaces === "borders" ? 0.89 : 0.92),
      g(0.3),
      "Rules and the edges of cards"
    ),
    // A field's edge and an unchecked box read at 3:1 on a card, as the skill asks.
    token(
      "color-input",
      g(0.64),
      g(0.52),
      "The edges of fields and checkboxes"
    ),
    token("color-ring", dials.brand, darkBrand, "The focus ring"),
  ];
};

/** A role's value in light and dark, as another token's. */
const like = (roles: readonly Token[], role: string, name: string) => {
  const found = roles.find((t) => t.name === role);
  return token(name, found?.value ?? "", found?.values?.dark);
};

/**
 * The detailed preset's colours (ADR 0062), by property and meaning, from the roles' values:
 * what text, a background or a border is for, each in Tailwind v4's namespace for it.
 */
const detailedColorsOf = (dials: LookDials, roles: readonly Token[]) => {
  const g = greyOf(dials.greys);
  return [
    {
      name: "Text",
      tokens: [
        like(roles, "color-foreground", "text-color-default"),
        like(roles, "color-muted-foreground", "text-color-subtle"),
        token("text-color-subtlest", g(0.58), g(0.6)),
        like(roles, "color-primary-foreground", "text-color-on-brand"),
        token("text-color-inverse", "oklch(1 0 0)"),
        like(roles, "color-primary", "text-color-brand"),
        like(roles, "color-destructive", "text-color-danger"),
      ],
    },
    {
      name: "Background",
      tokens: [
        like(roles, "color-background", "background-color-default"),
        like(roles, "color-card", "background-color-raised"),
        like(roles, "color-popover", "background-color-overlay"),
        like(roles, "color-muted", "background-color-neutral"),
        like(roles, "color-accent", "background-color-neutral-hovered"),
        like(roles, "color-primary", "background-color-brand-bold"),
        like(roles, "color-destructive", "background-color-danger-bold"),
        token(
          "background-color-danger-subtle",
          "oklch(0.97 0.02 27)",
          "oklch(0.3 0.07 27)"
        ),
      ],
    },
    {
      name: "Border",
      tokens: [
        like(roles, "color-border", "border-color-default"),
        like(roles, "color-input", "border-color-input"),
        like(roles, "color-ring", "border-color-focus"),
        like(roles, "color-destructive", "border-color-danger"),
      ],
    },
  ];
};

const SHADOWS = {
  lg: "0 12px 24px -6px rgb(0 0 0 / 0.14), 0 4px 8px -4px rgb(0 0 0 / 0.08)",
  md: "0 4px 10px -2px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
  sm: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
};

/**
 * The type scale, its body at the density's size and the rest in proportion, never under the
 * skill's floors: a caption 13px, interface text 14px. Density shows mostly in the spacing.
 */
const sizesOf = (density: Density) => {
  const body = Number.parseFloat(DENSITY[density].body);
  const rem = (factor: number, floor = 0) =>
    `${round3(Math.max(body * factor, floor))}rem`;
  return [
    { ...token("text-xs", rem(0.8, 0.8125)), lineHeight: "1.4" },
    { ...token("text-sm", rem(0.9, 0.875)), lineHeight: "1.45" },
    { ...token("text-base", rem(1)), lineHeight: "1.5" },
    { ...token("text-lg", rem(1.15)), lineHeight: "1.5" },
    { ...token("text-xl", rem(1.3)), lineHeight: "1.4" },
    { ...token("text-2xl", rem(1.6)), lineHeight: "1.3" },
    { ...token("text-3xl", rem(2)), lineHeight: "1.2" },
    { ...token("text-4xl", rem(2.4)), lineHeight: "1.15" },
  ];
};

const WEIGHTS = [
  token("font-weight-normal", "400"),
  token("font-weight-medium", "500"),
  token("font-weight-semibold", "600"),
  token("font-weight-bold", "700"),
];

const LEADING = [
  token("leading-tight", "1.25"),
  token("leading-snug", "1.375"),
  token("leading-normal", "1.5"),
  token("leading-relaxed", "1.625"),
];

/** The typeface the dials name, Inter when they name none the page offers. */
const typefaceOf = (dials: LookDials): Typeface =>
  TYPEFACES.find((t) => t.name === dials.typeface) ??
  (TYPEFACES[0] as Typeface);

/** The design system the dials come to, in light and dark. */
export const lookSystem = (dials: LookDials): DesignSystem => {
  const face = typefaceOf(dials);
  const fonts = [
    {
      description: `Every text: ${face.name}`,
      name: "font-sans",
      source: face.source,
      value: face.stack,
    },
    token(
      "font-mono",
      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      undefined,
      "Code and figures set in columns"
    ),
  ];
  const sizes = sizesOf(dials.density);
  const [sm, md, lg] = RADII[dials.corners];
  const raised = dials.surfaces === "shadows";
  const roles = colorsOf(dials);
  const detailed = dials.tokens === "detailed";
  return {
    colors: detailed
      ? detailedColorsOf(dials, roles)
      : [{ name: "Semantic", tokens: roles }],
    elevation: [
      {
        description: "The page and what sits flat on it",
        name: "Default",
        surface: "$color-background",
      },
      {
        description:
          dials.surfaces === "borders"
            ? "Cards and panels, edged with a hairline"
            : "Cards and panels",
        name: "Raised",
        ...(raised && { shadow: "$shadow-sm" }),
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
      description: `Lucide at a ${ICON_STROKES[dials.iconStroke]}px stroke, beside a label wherever there is room for one`,
      from: "lucide-react",
      sizes: [16, 20],
      stroke: ICON_STROKES[dials.iconStroke],
    },
    radius: [
      token("radius-sm", sm, undefined, "Items inside menus and lists"),
      token("radius-md", md, undefined, "Buttons, fields and popovers"),
      token("radius-lg", lg, undefined, "Cards and dialogs"),
    ],
    shadows: [
      token("shadow-sm", SHADOWS.sm, undefined, "Raised cards"),
      token("shadow-md", SHADOWS.md, undefined, "What is dragged"),
      token("shadow-lg", SHADOWS.lg, undefined, "Menus, popovers and dialogs"),
    ],
    source: "Chosen on the look page",
    spacing: { base: DENSITY[dials.density].spacing },
    themes: ["light", "dark"],
    ...(detailed && { tokenPreset: "detailed" as const }),
    typography: {
      fonts,
      leading: LEADING,
      sizes,
      styles: starterTextStyles({
        fonts,
        leading: LEADING,
        sizes,
        weights: WEIGHTS,
      }),
      weights: WEIGHTS,
    },
    version: 1,
  };
};

/** The dials in a line, as DESIGN.md's Overview writes a look's: "warm greys, soft corners…". */
export const dialsLine = (dials: LookDials): string =>
  [
    `${dials.typeface}`,
    `brand ${dials.brand}`,
    `${dials.greys} greys`,
    `${dials.corners} corners`,
    `${dials.density} density`,
    dials.surfaces === "flat"
      ? "flat surfaces"
      : `surfaces set apart by ${dials.surfaces}`,
    `${dials.iconStroke} icon strokes`,
    dials.tokens === "detailed"
      ? "colours named by property and meaning"
      : "colours named by role",
  ].join(", ");
