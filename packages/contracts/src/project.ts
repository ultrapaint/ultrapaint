import { Schema } from "effect";
import {
  ProjectIcon,
  ProjectIconColor,
  Settings,
  StorageInfo,
} from "./settings.ts";

/**
 * The project's icon as every client draws it (ADR 0107): the one it was given, or the default,
 * an image of the project found where a favicon is kept, else its name's initial in a colour taken
 * from the name. A file is drawn from the server (`PROJECT_IMAGE_ROUTE`).
 */
export const ShownProjectIcon = Schema.Union([
  ProjectIcon,
  Schema.Struct({
    color: ProjectIconColor,
    initial: Schema.String,
    kind: Schema.Literal("initial"),
  }),
]);
export type ShownProjectIcon = typeof ShownProjectIcon.Type;

/** An image of the project, by `?path=` from its folder: its icon, or one offered for it. */
export const PROJECT_IMAGE_ROUTE = "/api/project-image";

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
  /** The project's icon as it is shown, its default included (ADR 0107). */
  icon: Schema.optional(ShownProjectIcon),
  /** The name the project was given in its settings, else its folder's (ADR 0107). */
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
