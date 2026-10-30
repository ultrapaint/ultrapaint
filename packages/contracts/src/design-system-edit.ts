/**
 * The design system changed from the editor (ADR 0045, B8): a list of typed operations sent as
 * one `designSystem.edit`, applied in order by `applyEdits` (`design-document`) and written as
 * one undo step. A token is named as pages name it without the `$` (`color-primary-600`); a
 * theme is one of the design system's `themes`, the default theme when it is left out.
 *
 * Renaming a token, which rewrites the pages and the code, and gradient tokens are not here yet.
 */
import { Schema } from "effect";
import { TextStyle } from "./design-system.ts";

export const DesignSystemEdit = Schema.Union([
  /**
   * A token's value in a theme, the default theme's when `theme` is left out. Null takes another
   * theme's value out, so that the token has the default's there.
   */
  Schema.Struct({
    name: Schema.String,
    op: Schema.Literal("setValue"),
    theme: Schema.optional(Schema.String),
    value: Schema.NullOr(Schema.String),
  }),
  /** What a token is for; empty takes it out. */
  Schema.Struct({
    description: Schema.String,
    name: Schema.String,
    op: Schema.Literal("setDescription"),
  }),
  /**
   * A token added where its kind goes: a colour at the end of `group` (the semantic group, or
   * the first, when left out), any other kind at the end of its list.
   */
  Schema.Struct({
    description: Schema.optional(Schema.String),
    group: Schema.optional(Schema.String),
    name: Schema.String,
    op: Schema.Literal("addToken"),
    value: Schema.String,
    /** Its values in the other themes. */
    values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  Schema.Struct({ name: Schema.String, op: Schema.Literal("removeToken") }),
  /** A colour moved into a group, at `index` there or at its end. */
  Schema.Struct({
    group: Schema.String,
    index: Schema.optional(Schema.Int),
    name: Schema.String,
    op: Schema.Literal("moveToken"),
  }),
  /** An empty colour group, after the others. */
  Schema.Struct({ name: Schema.String, op: Schema.Literal("addGroup") }),
  Schema.Struct({
    name: Schema.String,
    op: Schema.Literal("renameGroup"),
    to: Schema.String,
  }),
  /** A text style set as given, in the place of the one of its name or after the others. */
  Schema.Struct({ op: Schema.Literal("setTextStyle"), style: TextStyle }),
  Schema.Struct({ name: Schema.String, op: Schema.Literal("removeTextStyle") }),
]);
export type DesignSystemEdit = typeof DesignSystemEdit.Type;

export const DesignSystemEditInput = Schema.Struct({
  /** What the undo history calls the step; one is made up from the operations otherwise. */
  label: Schema.optional(Schema.String),
  ops: Schema.Array(DesignSystemEdit),
});
export type DesignSystemEditInput = typeof DesignSystemEditInput.Type;
