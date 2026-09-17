import { Schema } from "effect";

export const GitFileStatus = Schema.Struct({
  /** Porcelain XY code, e.g. ` M`, `??`, `A `. */
  code: Schema.String,
  /** Whether the path is inside the designs directory. */
  design: Schema.Boolean,
  path: Schema.String,
  staged: Schema.Boolean,
});
export type GitFileStatus = typeof GitFileStatus.Type;

export const GitStatus = Schema.Struct({
  branch: Schema.String,
  files: Schema.Array(GitFileStatus),
});
export type GitStatus = typeof GitStatus.Type;

export const GitDiff = Schema.Struct({
  diff: Schema.String,
  path: Schema.String,
});
export type GitDiff = typeof GitDiff.Type;

export const GitCommitInput = Schema.Struct({
  message: Schema.String,
  paths: Schema.Array(Schema.String),
});
export const GitCommitResult = Schema.Struct({ sha: Schema.String });

export const Checkpoint = Schema.Struct({
  at: Schema.Number,
  files: Schema.Array(Schema.String),
  id: Schema.String,
  label: Schema.String,
  threadId: Schema.String,
});
export type Checkpoint = typeof Checkpoint.Type;
