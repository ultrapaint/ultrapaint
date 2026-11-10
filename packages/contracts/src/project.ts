import { Schema } from "effect";
import { Settings, StorageInfo } from "./settings.ts";

/** Who git says the user is in the repository: not an account, only its configuration. */
const GitUser = Schema.Struct({
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

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
  name: Schema.optional(Schema.String),
  repoPath: Schema.optional(Schema.String),
  /**
   * The settings in force: the editor is told of any change, a
   * field the rest of the info does not carry (`libraryDirs`) included. Absent when none are set.
   */
  settings: Schema.optional(Settings),
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
  source: Schema.Literals(["server", "agent"]),
  text: Schema.String,
});
export type LogLine = typeof LogLine.Type;
