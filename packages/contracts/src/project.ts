import { Schema } from "effect";
import { Settings, StorageInfo } from "./settings.ts";

/** Who git says the user is in the repository: not an account, only its configuration. */
const GitUser = Schema.Struct({
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

/** Where the server keeps what is not the project's code (ADR 0091), each absolute. */
export const ProjectFolders = Schema.Struct({
  /**
   * The project's own state folder (`<project>/.ultrapaint`): its chats, design history and
   * caches. Absent when nothing is saved, or the settings are kept in a `--home`.
   */
  project: Schema.optional(Schema.String),
  /**
   * The person's folder, the same in every project: their name, review findings and chat
   * preferences. `~/.ultrapaint`, or `.ultrapaint` wherever `--user-dir` put it.
   */
  user: Schema.String,
});
export type ProjectFolders = typeof ProjectFolders.Type;

export const ProjectInfo = Schema.Struct({
  branch: Schema.optional(Schema.String),
  configured: Schema.Boolean,
  designsDir: Schema.optional(Schema.String),
  /** The name the user gave in Settings, used when git gives none. */
  displayName: Schema.optional(Schema.String),
  /** Where the server keeps the person's data and the project's; absent from older servers. */
  folders: Schema.optional(ProjectFolders),
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
