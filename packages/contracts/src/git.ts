import { Schema } from "effect";

export const GitFileStatus = Schema.Struct({
  /** Porcelain XY code, e.g. ` M`, `??`, `A `. */
  code: Schema.String,
  /** Whether the path is inside the designs directory. */
  design: Schema.Boolean,
  path: Schema.String,
});
export type GitFileStatus = typeof GitFileStatus.Type;

export const GitStatus = Schema.Struct({
  files: Schema.Array(GitFileStatus),
});
export type GitStatus = typeof GitStatus.Type;

export const GitCommitInput = Schema.Struct({
  message: Schema.String,
  paths: Schema.Array(Schema.String),
});
export const GitCommitResult = Schema.Struct({ sha: Schema.String });
