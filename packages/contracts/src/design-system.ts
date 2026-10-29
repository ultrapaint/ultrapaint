/**
 * The design system as the tool knows it: `design-system.json` at the root of the designs
 * directory, written by the `/init` agent (or by the fixed-rule scan) and read by the inspector,
 * the Design system panel, the preview and every agent briefing. It holds every token's value
 * (ADR 0028); the code, Figma and DESIGN.md are compared with it. A token's name is the one pages
 * write without the `$` (`color-primary`); the style system maps it to its own
 * (`--color-primary` in Tailwind v4).
 */
import { Schema } from "effect";
import { SyncBaseline } from "./sync.ts";
import { DEFAULT_SPACING_BASE } from "./token-table.ts";

export const DESIGN_SYSTEM_FILE = "design-system.json";
/**
 * The design system's document in the open DESIGN.md format, at the root of the repository
 * (ADR 0027): what every agent and person reads, in the editor or not.
 */
export const DESIGN_MD_FILE = "DESIGN.md";
/** Where `DESIGN.md` was before ADR 0027: in the designs directory. Still read; Sync moves it. */
export const DESIGN_NOTES_FILE = "DESIGN.md";

export const Token = Schema.Struct({
  description: Schema.optional(Schema.String),
  /** The `@theme` variable without its dashes: `color-primary`, `radius-lg`, `text-sm`. */
  name: Schema.String,
  /**
   * The value in the default theme, resolved to CSS the browser understands. The design holds it
   * (ADR 0028); a file written before that leaves it out for a token the code declares, and the
   * code's is read until the file is written again.
   */
  value: Schema.String,
  /** Values in other themes, by theme name. */
  values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type Token = typeof Token.Type;

/** Tokens that belong together: a palette (`blue`), the semantic colours, the radii. */
export const TokenGroup = Schema.Struct({
  name: Schema.String,
  tokens: Schema.Array(Token),
});
export type TokenGroup = typeof TokenGroup.Type;

/** A font size token, with the line height Tailwind pairs with it. */
export const FontSizeToken = Schema.Struct({
  ...Token.fields,
  lineHeight: Schema.optional(Schema.String),
});
export type FontSizeToken = typeof FontSizeToken.Type;

/**
 * Where a text style sits in the type scale: the headings, the body copy, or the rest (captions,
 * labels, code). The inspector and the Design system panel list the styles by group.
 */
export const TextStyleGroup = Schema.Literals(["heading", "body", "other"]);
export type TextStyleGroup = typeof TextStyleGroup.Type;

/** The groups in the order they are listed, with their titles. */
export const TEXT_STYLE_GROUPS: readonly {
  readonly group: TextStyleGroup;
  readonly label: string;
}[] = [
  { group: "heading", label: "Headings" },
  { group: "body", label: "Body" },
  { group: "other", label: "Others" },
];

/**
 * A named combination of type settings: a font size, a weight and a line height (and a family
 * and tracking when the style sets them) that a text is set in as one thing. A text that points
 * at a style gets all of its settings, and its classes, at once; one that has been detached
 * from the style carries them as its own fields.
 */
export const TextStyle = Schema.Struct({
  description: Schema.optional(Schema.String),
  font: Schema.optional(Schema.String),
  /** Left out, a heading style is a heading and a paragraph style is body copy. */
  group: Schema.optional(TextStyleGroup),
  level: Schema.optional(Schema.Int),
  lineHeight: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  name: Schema.String,
  role: Schema.Literals(["heading", "paragraph"]),
  /** Token references (`"$text-4xl"`) or CSS. */
  size: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  tracking: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  weight: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
});
export type TextStyle = typeof TextStyle.Type;

/** The group a style is listed under, from its role when it does not say. */
export const textStyleGroup = (style: TextStyle): TextStyleGroup =>
  style.group ?? (style.role === "heading" ? "heading" : "body");

/** A style's settings that a text takes from it: what detaching copies and attaching clears. */
export const TEXT_STYLE_SETTINGS = [
  "size",
  "weight",
  "lineHeight",
  "font",
  "tracking",
] as const;
export type TextStyleSetting = (typeof TEXT_STYLE_SETTINGS)[number];

export const FontFamily = Schema.Struct({
  ...Token.fields,
  /** Where the font is loaded from: a package, a stylesheet, a system font. */
  source: Schema.optional(Schema.String),
});
export type FontFamily = typeof FontFamily.Type;

/**
 * A level of elevation: the surface colour a layer is drawn in, the shadow that goes with it, and
 * where it sits in the stacking order. Most design systems have four: sunken, default, raised
 * (a card that moves) and overlay (a menu, a dialog, a tooltip).
 */
export const ElevationLevel = Schema.Struct({
  description: Schema.optional(Schema.String),
  /** The z-index the level is implemented with; left out for levels that never overlap. */
  layer: Schema.optional(Schema.Int),
  name: Schema.String,
  /** A shadow token (`"$shadow-lg"`) or a CSS box-shadow. */
  shadow: Schema.optional(Schema.String),
  /** A colour token (`"$color-popover"`) or CSS. */
  surface: Schema.optional(Schema.String),
});
export type ElevationLevel = typeof ElevationLevel.Type;

/** Breakpoints and container widths: `--breakpoint-*` and `--container-*`. */
export const LayoutTokens = Schema.Struct({
  breakpoints: Schema.optional(Schema.Array(Token)),
  /** `$container-md` is max-w-md. */
  containers: Schema.optional(Schema.Array(Token)),
});
export type LayoutTokens = typeof LayoutTokens.Type;

/**
 * How things move: `--ease-*` and `--animate-*`, and the durations a project names as
 * `--duration-*` (Tailwind has no namespace for them; agents write them into code).
 */
export const MotionTokens = Schema.Struct({
  animations: Schema.optional(Schema.Array(Token)),
  durations: Schema.optional(Schema.Array(Token)),
  easings: Schema.optional(Schema.Array(Token)),
});
export type MotionTokens = typeof MotionTokens.Type;

/** The icon set the product draws with, and the sizes it uses. */
export const IconSet = Schema.Struct({
  description: Schema.optional(Schema.String),
  /** The package the icons are imported from: `lucide-react`. */
  from: Schema.optional(Schema.String),
  /** Sizes in pixels, smallest first. */
  sizes: Schema.optional(Schema.Array(Schema.Number)),
});
export type IconSet = typeof IconSet.Type;

/** Who matched a token of `DESIGN.md` to the design system's: the rules, an agent, or the user. */
export const DocumentMatchSource = Schema.Literals(["rule", "agent", "user"]);
export type DocumentMatchSource = typeof DocumentMatchSource.Type;

/** What a token of `DESIGN.md` is in the design system: `to` its token, null when left out. */
export const DocumentMatch = Schema.Struct({
  by: DocumentMatchSource,
  to: Schema.NullOr(Schema.String),
});
export type DocumentMatch = typeof DocumentMatch.Type;

/**
 * What a side and the design system last agreed on: for `DESIGN.md`'s front matter (ADR 0027)
 * each mirrored value by its path in the document (`colors.primary`,
 * `typography.body.fontSize`) and what each of the document's tokens is in the design system,
 * by path; for the code (ADR 0028) each value by `name` and `name@theme`.
 */
export const DocumentBaseline = Schema.Struct({
  agreed: Schema.Record(Schema.String, Schema.String),
  at: Schema.Number,
  matches: Schema.optional(Schema.Record(Schema.String, DocumentMatch)),
});
export type DocumentBaseline = typeof DocumentBaseline.Type;

export const DesignSystem = Schema.Struct({
  /** `--border-width-*`: Tailwind has no namespace for them, so `$border-width-thin` is a variable. */
  borderWidths: Schema.optional(Schema.Array(Token)),
  /**
   * What the design system and the code last agreed on (ADR 0028): each token's value by
   * `name` and `name@theme`.
   */
  codeSync: Schema.optional(DocumentBaseline),
  colors: Schema.Array(TokenGroup),
  /** What `DESIGN.md` and the design system last agreed on (ADR 0027). */
  designMd: Schema.optional(DocumentBaseline),
  /** Elevation levels, lowest first. */
  elevation: Schema.optional(Schema.Array(ElevationLevel)),
  icons: Schema.optional(IconSet),
  layout: Schema.optional(LayoutTokens),
  motion: Schema.optional(MotionTokens),
  /**
   * Tokens of the code the design system leaves out on purpose, by name: the sync does not ask
   * for them to be described.
   */
  omitted: Schema.optional(Schema.Array(Schema.String)),
  radius: Schema.Array(Token),
  shadows: Schema.Array(Token),
  /** Where it was read from, for the panel: the stylesheet, the scan, the agent. */
  source: Schema.optional(Schema.String),
  spacing: Schema.Struct({
    /** `--spacing`, the step every spacing utility multiplies. */
    base: Schema.String,
    /** Named spacing tokens beyond the multiples of the base. */
    tokens: Schema.optional(Schema.Array(Token)),
  }),
  /** What the last sync with Figma agreed on (ADR 0025). */
  sync: Schema.optional(SyncBaseline),
  /** Names of the themes the values are given in, the default first. */
  themes: Schema.optional(Schema.Array(Schema.String)),
  typography: Schema.Struct({
    fonts: Schema.Array(FontFamily),
    leading: Schema.optional(Schema.Array(Token)),
    sizes: Schema.Array(FontSizeToken),
    styles: Schema.Array(TextStyle),
    tracking: Schema.optional(Schema.Array(Token)),
    weights: Schema.Array(Token),
  }),
  version: Schema.Literal(1),
});
export type DesignSystem = typeof DesignSystem.Type;

/**
 * The type scale a design system starts with when nothing has named its styles: six heading
 * sizes, three body sizes, and a caption, a label and code. Each is built from the theme's own
 * tokens, so a size or weight the theme does not have leaves that style out.
 */
export const starterTextStyles = (
  typography: Pick<
    DesignSystem["typography"],
    "fonts" | "leading" | "sizes" | "weights"
  >
): TextStyle[] => {
  const has = (tokens: readonly Token[] | undefined, name: string) =>
    tokens?.some((t) => t.name === name) ?? false;
  const weight = (name: string) =>
    has(typography.weights, `font-weight-${name}`)
      ? `$font-weight-${name}`
      : undefined;
  const leading = (name: string) =>
    has(typography.leading, `leading-${name}`) ? `$leading-${name}` : undefined;
  const style = (
    name: string,
    group: TextStyleGroup,
    size: string,
    weightName: string,
    leadingName: string,
    extra: Partial<TextStyle> = {}
  ): TextStyle | undefined => {
    if (!has(typography.sizes, `text-${size}`)) {
      return undefined;
    }
    const w = weight(weightName);
    const l = leading(leadingName);
    return {
      group,
      name,
      role: group === "heading" ? "heading" : "paragraph",
      size: `$text-${size}`,
      ...(w && { weight: w }),
      ...(l && { lineHeight: l }),
      ...extra,
    };
  };
  const mono = has(typography.fonts, "font-mono") ? "$font-mono" : undefined;
  return [
    style("Heading xxl", "heading", "4xl", "bold", "tight", { level: 1 }),
    style("Heading xl", "heading", "3xl", "bold", "tight", { level: 2 }),
    style("Heading lg", "heading", "2xl", "semibold", "snug", { level: 3 }),
    style("Heading md", "heading", "xl", "semibold", "snug", { level: 4 }),
    style("Heading sm", "heading", "lg", "semibold", "normal", { level: 5 }),
    style("Heading xs", "heading", "base", "semibold", "normal", { level: 6 }),
    style("Body lg", "body", "lg", "normal", "relaxed"),
    style("Body", "body", "base", "normal", "normal"),
    style("Body sm", "body", "sm", "normal", "normal"),
    style("Caption", "other", "xs", "normal", "normal"),
    style("Label", "other", "sm", "medium", "tight"),
    style(
      "Code",
      "other",
      "sm",
      "normal",
      "normal",
      mono ? { font: mono } : {}
    ),
  ].filter((s): s is TextStyle => s !== undefined);
};

/**
 * The elevation a design system starts with when nothing has named its levels: sunken, default,
 * raised and overlay, from the semantic surfaces shadcn-style themes have (`color-muted`,
 * `color-background`, `color-card`, `color-popover`) and the theme's own shadows. A level whose
 * surface the theme does not have is left out.
 */
export const starterElevation = (
  ds: Pick<DesignSystem, "colors" | "shadows">
): ElevationLevel[] => {
  const colors = new Set(ds.colors.flatMap((g) => g.tokens.map((t) => t.name)));
  const shadows = new Set(ds.shadows.map((t) => t.name));
  const surface = (...names: string[]) => {
    const found = names.find((n) => colors.has(`color-${n}`));
    return found === undefined ? undefined : `$color-${found}`;
  };
  const shadow = (...names: string[]) => {
    const found = names.find((n) => shadows.has(`shadow-${n}`));
    return found === undefined ? undefined : `$shadow-${found}`;
  };
  const level = (
    name: string,
    description: string,
    surfaceOf: string | undefined,
    extra: Partial<ElevationLevel> = {}
  ): ElevationLevel | undefined =>
    surfaceOf === undefined
      ? undefined
      : { description, name, surface: surfaceOf, ...extra };
  const raised = shadow("sm", "xs");
  const overlay = shadow("lg", "md");
  return [
    level(
      "Sunken",
      "Below the page: a well that groups content, a code block, a track.",
      surface("muted")
    ),
    level(
      "Default",
      "The page itself; flat cards on it take a border, not a shadow.",
      surface("background")
    ),
    level(
      "Raised",
      "A card that stands off the page or can be moved.",
      surface("card", "background"),
      raised ? { shadow: raised } : {}
    ),
    level(
      "Overlay",
      "Above everything else: menus, popovers, dialogs, tooltips.",
      surface("popover", "card", "background"),
      { layer: 50, ...(overlay && { shadow: overlay }) }
    ),
  ].filter((l): l is ElevationLevel => l !== undefined);
};

export const emptyDesignSystem = (): DesignSystem => ({
  colors: [],
  radius: [],
  shadows: [],
  spacing: { base: DEFAULT_SPACING_BASE },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
});

/** What the format's linter, or the reading of the file, says about `DESIGN.md`. */
export const DesignFinding = Schema.Struct({
  message: Schema.String,
  /** Where in the file: `colors.primary`, `components.button`. */
  path: Schema.optional(Schema.String),
  severity: Schema.Literals(["error", "warning", "info"]),
});
export type DesignFinding = typeof DesignFinding.Type;

/** A `##` section of `DESIGN.md`. */
export const DesignSection = Schema.Struct({
  heading: Schema.String,
  /** The format's section the heading names (`Overview` for "Brand & Style"); null for others. */
  section: Schema.NullOr(Schema.String),
  text: Schema.String,
});
export type DesignSection = typeof DesignSection.Type;

/** A value of `DESIGN.md`'s front matter that differs from the design system's and is waiting for Sync. */
export const DocumentHeld = Schema.Struct({
  code: Schema.optional(Schema.String),
  doc: Schema.optional(Schema.String),
  /** `doc`: changed in the document only. `both`: changed on both sides. */
  kind: Schema.Literals(["doc", "both"]),
  /** `colors.primary`, `typography.body.fontSize`. */
  path: Schema.String,
});
export type DocumentHeld = typeof DocumentHeld.Type;

/** `DESIGN.md` as the editor reads it (ADR 0027). */
export const DesignDocument = Schema.Struct({
  /** The text after the front matter: what agents are told. */
  body: Schema.String,
  findings: Schema.Array(DesignFinding),
  /** Values of the front matter the code does not have yet, or differs on. */
  held: Schema.Array(DocumentHeld),
  /** In the designs directory, where it was before ADR 0027: Sync moves it to the root. */
  legacy: Schema.Boolean,
  /** Repository-relative. */
  path: Schema.String,
  sections: Schema.Array(DesignSection),
  text: Schema.String,
});
export type DesignDocument = typeof DesignDocument.Type;

/** What the editor reads: the design system, its document, and whether init has run. */
export const DesignSystemState = Schema.Struct({
  designSystem: Schema.NullOr(DesignSystem),
  /** `DESIGN.md`, when there is one. */
  document: Schema.NullOr(DesignDocument),
  /**
   * What `design.tokens.json` holds that the design system could not take: a token of no kind it
   * lists, a value that does not read as CSS, an alias to nothing.
   */
  notes: Schema.optional(Schema.Array(Schema.String)),
  /**
   * Why `design-system.json` cannot be read, when it cannot; or why `design.tokens.json`
   * cannot, beside the design system read without its values (ADR 0035).
   */
  problem: Schema.optional(Schema.String),
});
export type DesignSystemState = typeof DesignSystemState.Type;
