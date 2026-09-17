import * as S from "effect/Schema";

export const GitFileStatus = S.Struct({
  path: S.String,
  /** Porcelain XY code, e.g. ` M`, `??`, `A `. */
  code: S.String,
  staged: S.Boolean,
  /** Whether the path is inside the designs directory. */
  design: S.Boolean,
});
export type GitFileStatus = typeof GitFileStatus.Type;

export const GitStatus = S.Struct({
  branch: S.String,
  files: S.Array(GitFileStatus),
});
export type GitStatus = typeof GitStatus.Type;

export const GitDiff = S.Struct({ path: S.String, diff: S.String });
export type GitDiff = typeof GitDiff.Type;

export const GitCommitInput = S.Struct({ message: S.String, paths: S.Array(S.String) });
export const GitCommitResult = S.Struct({ sha: S.String });

export const Checkpoint = S.Struct({
  id: S.String,
  threadId: S.String,
  label: S.String,
  at: S.Number,
  files: S.Array(S.String),
});
export type Checkpoint = typeof Checkpoint.Type;
