/**
 * Design tokens as the code declares them, whatever styles it (ADR 0024). A style system adapter
 * reads them from where its library keeps them — Tailwind v4's `@theme`, a StyleX `defineVars`,
 * an Emotion theme object — and writes them back there. Everything above the adapter speaks
 * these: the design system's values, the sync, the Figma comparison.
 *
 * A token's name is the one pages already use without the `$`: `color-primary`, `radius-lg`,
 * `text-sm`. The preview draws `$color-primary` as the custom property `--color-primary`, which
 * the adapter makes sure the preview defines.
 */
import { Schema } from "effect";

/** Which style system a repository's tokens and classes are written in. */
export const StyleSystemId = Schema.Literals(["tailwind-v4"]);
export type StyleSystemId = typeof StyleSystemId.Type;
export const defaultStyleSystem: StyleSystemId = "tailwind-v4";

export const TokenKind = Schema.Literals([
  "color",
  "spacing",
  "fontSize",
  "fontWeight",
  "font",
  "leading",
  "tracking",
  "radius",
  "shadow",
  "blur",
  "borderWidth",
  "breakpoint",
  "container",
  "easing",
  "duration",
  "animation",
  "other",
]);
export type TokenKind = typeof TokenKind.Type;

/** Where a value is written: the text between `start` and `end` of a repository file. */
export const TokenOrigin = Schema.Struct({
  end: Schema.Number,
  /** Repo-relative, posix. */
  file: Schema.String,
  start: Schema.Number,
});
export type TokenOrigin = typeof TokenOrigin.Type;

export const SourceToken = Schema.Struct({
  kind: TokenKind,
  name: Schema.String,
  /** Where the value of each theme is written, the default theme under `""`. */
  origins: Schema.optional(Schema.Record(Schema.String, TokenOrigin)),
  /** Declared by the repository, not one of the style system's own defaults. */
  own: Schema.Boolean,
  /** The value in the default theme, as the code writes it. */
  value: Schema.String,
  /** Values in other themes, by theme name. */
  values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /**
   * Declared as a plain variable, outside what makes the style system's utility classes
   * (Tailwind's `@theme`): it has no class, and the code uses its variable, `bg-(--color-panel)`.
   */
  variableOnly: Schema.optional(Schema.Boolean),
});
export type SourceToken = typeof SourceToken.Type;

export const TokenSource = Schema.Struct({
  /** The files read, repo-relative. */
  files: Schema.Array(Schema.String),
  /**
   * What could not be read, in words an agent or a user can follow up on. A note about one token
   * starts with its name (`color-panel is declared both in @theme …`).
   */
  notes: Schema.Array(Schema.String),
  /** Themes besides the default the values are given in. */
  themes: Schema.Array(Schema.String),
  tokens: Schema.Array(SourceToken),
});
export type TokenSource = typeof TokenSource.Type;

/**
 * A token set, changed or taken out. `theme` is left out for the default theme. A token that is
 * not declared yet is added where the adapter adds new ones.
 */
export const TokenChange = Schema.Struct({
  name: Schema.String,
  remove: Schema.optional(Schema.Boolean),
  theme: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
});
export type TokenChange = typeof TokenChange.Type;

/** A repository file as a change leaves it. */
export const FileEdit = Schema.Struct({
  /** Repo-relative, posix. */
  file: Schema.String,
  text: Schema.String,
});
export type FileEdit = typeof FileEdit.Type;

/**
 * What writing one token change does to the code (ADR 0158): changes a declaration where it is,
 * adds one, takes one out, or leaves the code as it is, its value the change's already.
 */
export const TokenWrite = Schema.Struct({
  does: Schema.Literals(["change", "add", "remove", "none"]),
  /** Where, repo-relative and posix; left out when no stylesheet holds or takes it. */
  file: Schema.optional(Schema.String),
  /** The value as the code wrote it before; left out for one added. */
  from: Schema.optional(Schema.String),
  name: Schema.String,
  /** Left out for the default theme. */
  theme: Schema.optional(Schema.String),
  /** The value as written now; left out when nothing is written, or one is taken out. */
  to: Schema.optional(Schema.String),
});
export type TokenWrite = typeof TokenWrite.Type;

/** Token changes written: the files they leave changed, and what each change did. */
export interface TokenWriting {
  readonly edits: readonly FileEdit[];
  /** One for each change, in the order given; a token changed twice in a theme, once. */
  readonly writes: readonly TokenWrite[];
}
