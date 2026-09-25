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

/** A named combination of type settings: what a heading or a paragraph is set in. */
export const TextStyle = Schema.Struct({
  description: Schema.optional(Schema.String),
  font: Schema.optional(Schema.String),
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
