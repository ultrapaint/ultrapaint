import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";

export const UndoState = Schema.Struct({
  canRedo: Schema.Boolean,
  canUndo: Schema.Boolean,
  invalidated: Schema.optional(Schema.String),
  redoLabel: Schema.optional(Schema.String),
  undoLabel: Schema.optional(Schema.String),
});
export type UndoState = typeof UndoState.Type;

/** What an undo or a redo put back: the files it touched. */
export const UndoResult = Schema.Struct({
  files: Schema.Array(RepoRelativePath),
  label: Schema.String,
});
export type UndoResult = typeof UndoResult.Type;
