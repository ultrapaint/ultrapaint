/**
 * The design system as the tool knows it: `design-system.json` at the root of the designs
 * directory, written by the `/init` agent (or by the fixed-rule scan) and read by the inspector,
 * the Design system panel, the preview and every agent briefing. Tailwind v4 only: a token's
 * name is the name of its `@theme` variable without the leading dashes, so `color-primary` is
 * `--color-primary`, and the utilities it becomes follow from that name (ADR 0015).
 */
import { Schema } from "effect";
import { Json } from "./base.ts";

export const DESIGN_SYSTEM_FILE = "design-system.json";
export const DESIGN_NOTES_FILE = "DESIGN.md";

export const Token = Schema.Struct({
  description: Schema.optional(Schema.String),
  /** The `@theme` variable without its dashes: `color-primary`, `radius-lg`, `text-sm`. */
  name: Schema.String,
  /** The value in the default theme, resolved to CSS the browser understands. */
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

/** What the tool knows about one component beyond what its types say. */
export const ComponentNotes = Schema.Struct({
  category: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  /** Props a new instance starts with, and its thumbnail is drawn with. */
  exampleProps: Schema.optional(Schema.Record(Schema.String, Json)),
  /** Text a new instance starts with as its children. */
  exampleText: Schema.optional(Schema.String),
  /** Module it is imported from, when the name alone is ambiguous. */
  from: Schema.optional(Schema.String),
});
export type ComponentNotes = typeof ComponentNotes.Type;

export const DesignSystem = Schema.Struct({
  colors: Schema.Array(TokenGroup),
  /** Notes by component export name. */
  components: Schema.optional(Schema.Record(Schema.String, ComponentNotes)),
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

export const emptyDesignSystem = (): DesignSystem => ({
  colors: [],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
});

/** What the editor reads: the design system, its notes, and whether init has run. */
export const DesignSystemState = Schema.Struct({
  designSystem: Schema.NullOr(DesignSystem),
  /** Contents of `DESIGN.md`, when there is one. */
  notes: Schema.NullOr(Schema.String),
  /** Why `design-system.json` cannot be read, when it cannot. */
  problem: Schema.optional(Schema.String),
});
export type DesignSystemState = typeof DesignSystemState.Type;
