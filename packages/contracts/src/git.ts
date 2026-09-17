import { Schema as S } from "effect";

export const GitFileStatus = S.Struct({
  /** Porcelain XY code, e.g. ` M`, `??`, `A `. */
  code: S.String,
  /** Whether the path is inside the designs directory. */
  design: S.Boolean,
  path: S.String,
  staged: S.Boolean,
});
export type GitFileStatus = typeof GitFileStatus.Type;

export const GitStatus = S.Struct({
  branch: S.String,
  files: S.Array(GitFileStatus),
});
export type GitStatus = typeof GitStatus.Type;

export const GitDiff = S.Struct({ diff: S.String, path: S.String });
export type GitDiff = typeof GitDiff.Type;

export const GitCommitInput = S.Struct({
  message: S.String,
  paths: S.Array(S.String),
});
export const GitCommitResult = S.Struct({ sha: S.String });

export const Checkpoint = S.Struct({
  at: S.Number,
  files: S.Array(S.String),
  id: S.String,
  label: S.String,
  threadId: S.String,
});
export type Checkpoint = typeof Checkpoint.Type;
