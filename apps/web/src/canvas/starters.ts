/**
 * The starters an empty canvas offers, and the look their thumbnails are drawn in. With a design
 * system they follow the library — a starter whose components it has none of is not offered —
 * and are drawn in its colours, radius and heading font; without one they are plain wireframes.
 */
import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";
import { tokensOfKind } from "@ultrapaint/contracts/token-table";

export type StarterId =
  | "article"
  | "dashboard"
  | "landing"
  | "pricing"
  | "settings"
  | "sign-in";

export interface Starter {
  readonly id: StarterId;
  readonly label: string;
  /** Offered only when the library has one of these; none means always. */
  readonly needs: readonly string[];
  /** The page, as the prompt asks for it. */
  readonly page: string;
  /** What it is built from, by export name. */
  readonly uses: readonly string[];
}

/** In the order they are offered: the first ones the library allows fill the strip. */
export const STARTERS: readonly Starter[] = [
  {
    id: "landing",
    label: "Landing",
    needs: [],
    page: "a landing page with a navigation bar, a hero with a call to action and three feature cards",
    uses: ["Button", "Card", "Badge"],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    needs: ["Table", "Chart"],
    page: "a dashboard with a sidebar, stat cards, a chart and a table",
    uses: ["Sidebar", "Card", "Chart", "Table"],
  },
  {
    id: "settings",
    label: "Settings",
    needs: ["Input", "Switch"],
    page: "a settings page with tabs over a form of fields and switches",
    uses: ["Tabs", "Input", "Switch", "Select"],
  },
  {
    id: "sign-in",
    label: "Sign in",
    needs: ["Input"],
    page: "a sign-in page: a card with the email and password fields and a button",
    uses: ["Card", "Input", "Label", "Button"],
  },
  {
    id: "pricing",
    label: "Pricing",
    needs: ["Card"],
    page: "a pricing page with three plans side by side and an FAQ under them",
    uses: ["Card", "Badge", "Button", "Accordion"],
  },
  {
    id: "article",
    label: "Article",
    needs: [],
    page: "an article page with a title, a byline and long-form text",
    uses: ["Avatar", "Badge", "Separator"],
  },
];

const SHOWN = 4;

/**
 * Whether the library has a component, or a family of them: `Chart` is there when only
 * `ChartContainer` is.
 */
const CAPITAL = /[A-Z]/;

const has = (catalogue: Catalogue, name: string) =>
  catalogue.components.some(
    (c) =>
      c.name === name ||
      (c.name.startsWith(name) && CAPITAL.test(c.name.charAt(name.length)))
  );

export interface Offered {
  readonly starter: Starter;
  /** The components of the library it would use; empty for a plain wireframe. */
  readonly uses: readonly string[];
}

/**
 * The starters shown. Without a design system, or before the library is read, they are the
 * first ones and plain: nothing of the library goes into them.
 */
export const offeredStarters = (
  catalogue: Catalogue | null,
  withSystem: boolean
): readonly Offered[] => {
  if (!(withSystem && catalogue)) {
    return STARTERS.slice(0, SHOWN).map((starter) => ({ starter, uses: [] }));
  }
  return STARTERS.filter(
    (s) => s.needs.length === 0 || s.needs.some((n) => has(catalogue, n))
  )
    .slice(0, SHOWN)
    .map((starter) => ({
      starter,
      uses: starter.uses.filter((n) => has(catalogue, n)),
    }));
};

const listed = (names: readonly string[]) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** What the chat's composer is given: the page asked for, left open for the user to finish. */
export const starterPrompt = (
  { starter, uses }: Offered,
  canvas: string,
  withSystem: boolean
) => {
  let how = "as a plain wireframe";
  if (withSystem) {
    how =
      uses.length > 0
        ? `with the design system's ${listed(uses)}`
        : "with the design system's components";
  }
  return `Design ${starter.page} on the ${canvas} canvas, ${how}. It is for `;
};

export interface StarterTheme {
  readonly accent?: string;
  readonly border?: string;
  readonly card?: string;
  /** The heading font as CSS, and the name of its first family. */
  readonly font?: { readonly css: string; readonly name: string };
  readonly foreground?: string;
  /** In thumbnail pixels: a page's radius drawn at the thumbnail's scale. */
  readonly radius: number;
  readonly surface?: string;
}

/**
 * A colour by the role its name gives it: `color-primary`, else the middle of the
 * `color-primary-*` scale, trying each stem in turn.
 */
const colour = (tokens: readonly Token[], ...stems: string[]) => {
  for (const stem of stems) {
    const exact = tokens.find((t) => t.name === `color-${stem}`);
    if (exact) {
      return exact.value;
    }
    const scale = tokens.filter((t) => t.name.startsWith(`color-${stem}-`));
    const middle = scale[Math.floor((scale.length - 1) / 2)];
    if (middle) {
      return middle.value;
    }
  }
};

const LENGTH = /^[\d.]+(px|r?em)$/;
const QUOTES = /^["']|["']$/g;

const pixels = (value: string) => {
  const length = value.trim();
  if (!LENGTH.test(length)) {
    return;
  }
  const n = Number.parseFloat(length);
  return length.endsWith("px") ? n : n * 16;
};

const RADIUS_NAMES = ["radius-md", "radius-lg", "radius", "radius-sm"];

/** The radius a card of the design system has, halved for the thumbnail and kept small. */
const radiusOf = (tokens: readonly Token[]) => {
  const token =
    RADIUS_NAMES.map((n) => tokens.find((t) => t.name === n)).find(Boolean) ??
    tokens.find((t) => !t.name.endsWith("-full"));
  const px = token ? pixels(token.value) : undefined;
  return px === undefined ? 3 : Math.min(8, Math.max(1, Math.round(px / 2)));
};

const FONT_NAMES = ["font-heading", "font-display", "font-sans", "font-body"];

const fontOf = (ds: DesignSystem) => {
  const fonts = tokensOfKind(ds, "font");
  const font =
    FONT_NAMES.map((n) => fonts.find((f) => f.name === n)).find(Boolean) ??
    fonts[0];
  const name = font?.value.split(",")[0]?.trim().replace(QUOTES, "");
  return font && name ? { css: font.value, name } : undefined;
};

export const starterTheme = (ds: DesignSystem): StarterTheme => {
  const colours = tokensOfKind(ds, "color");
  return {
    accent: colour(colours, "primary", "brand", "accent"),
    border: colour(colours, "border", "input"),
    card: colour(colours, "card", "surface", "background"),
    font: fontOf(ds),
    foreground: colour(colours, "foreground", "text"),
    radius: radiusOf(tokensOfKind(ds, "radius")),
    surface: colour(colours, "background", "surface"),
  };
};
