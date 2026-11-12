import { Schema } from "effect";

export const GitFileStatus = Schema.Struct({
  /** Porcelain XY code, e.g. ` M`, `??`, `A `. */
  code: Schema.String,
  /**
   * Whether Ultrapaint writes the file: inside the designs directory, or the design system's
   * `DESIGN.md`. The Changes panel lists the others only when asked (ADR 0076).
   */
  design: Schema.Boolean,
  /**
   * Lines added and removed since the last commit, as `git diff --numstat` counts them (a new
   * file's lines are all added); absent for a binary file, or one git could not count.
   */
  lines: Schema.optional(
    Schema.Struct({ added: Schema.Number, removed: Schema.Number })
  ),
  path: Schema.String,
});
export type GitFileStatus = typeof GitFileStatus.Type;

export const GitStatus = Schema.Struct({
  /** The branch checked out; absent on a detached HEAD. */
  branch: Schema.optional(Schema.String),
  files: Schema.Array(GitFileStatus),
  /** The last commit of the branch: its subject and when it was made. Absent before the first. */
  lastCommit: Schema.optional(
    Schema.Struct({ at: Schema.Number, message: Schema.String })
  ),
});
export type GitStatus = typeof GitStatus.Type;

export const GitCommitInput = Schema.Struct({
  message: Schema.String,
  paths: Schema.Array(Schema.String),
});
export const GitCommitResult = Schema.Struct({ sha: Schema.String });
