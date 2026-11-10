import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";

/**
 * A history dropped because it could no longer be walked: which one, and why in words that follow
 * "Nothing to undo:". It holds until the next edit.
 */
const DroppedHistory = Schema.Struct({
  history: Schema.Literals(["undo", "redo"]),
  reason: Schema.String,
});

export const UndoState = Schema.Struct({
  canRedo: Schema.Boolean,
  canUndo: Schema.Boolean,
  invalidated: Schema.optional(DroppedHistory),
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
