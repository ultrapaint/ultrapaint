import { Schema } from "effect";
import { StorageInfo } from "./settings.ts";

export const HostStatus = Schema.Struct({
  error: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Number),
  port: Schema.optional(Schema.Number),
  state: Schema.Literals(["stopped", "starting", "running", "error"]),
  url: Schema.optional(Schema.String),
});
export type HostStatus = typeof HostStatus.Type;

/** Who git says the user is in the repository: not an account, only its configuration. */
export const GitUser = Schema.Struct({
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});
export type GitUser = typeof GitUser.Type;

export const ProjectInfo = Schema.Struct({
  branch: Schema.optional(Schema.String),
  configured: Schema.Boolean,
  designsDir: Schema.optional(Schema.String),
  /** The name the user gave in Settings, used when git gives none. */
  displayName: Schema.optional(Schema.String),
  /**
   * Whether the folder is in a git repository the tool can read: its status, diffs and branch.
   * Absent or false, there is no git or no repository, and the tool works without them.
   */
  gitRepository: Schema.optional(Schema.Boolean),
  /** `user.name` and `user.email` from the repository's git configuration, when set. */
  gitUser: Schema.optional(GitUser),
  host: HostStatus,
  name: Schema.optional(Schema.String),
  repoPath: Schema.optional(Schema.String),
  /**
   * Where the open project's settings came from: `saved` by someone, or `detected` from the
   * repository the server was started in, because nothing was saved.
   */
  setup: Schema.optional(Schema.Literals(["saved", "detected"])),
  /** Where settings and tool state are kept; drives the "not saved" warning. */
  storage: StorageInfo,
});
export type ProjectInfo = typeof ProjectInfo.Type;

export const LogLine = Schema.Struct({
  at: Schema.Number,
  level: Schema.Literals(["info", "warn", "error"]),
  source: Schema.Literals(["host", "server", "agent"]),
  text: Schema.String,
});
export type LogLine = typeof LogLine.Type;
