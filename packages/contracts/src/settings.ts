import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { SkillsConfig } from "./skills.ts";
import { StyleSystemId } from "./tokens.ts";

/** Which renderer, builder and source tooling the target repository is driven with. */
export const FrameworkId = Schema.Literals(["react-vite"]);
export type FrameworkId = typeof FrameworkId.Type;
export const defaultFramework: FrameworkId = "react-vite";

export const Theme = Schema.Literals(["light", "dark"]);

/** Whether the tool may write to git (PLAN-desktop D9). */
export const GitWrites = Schema.Literals(["off", "on"]);
export type GitWrites = typeof GitWrites.Type;

/** Whether writing to git is on in these settings; off unless said. */
export const writesGit = (settings: { readonly git?: GitWrites | undefined }) =>
  settings.git === "on";

const common = {
  /**
   * Whether a token changed in the design is written to the code at once (`auto`) or waits in
   * Sync for an export (`manual`, the default): the design holds the values (ADR 0028).
   */
  codeTokens: Schema.optional(Schema.Literals(["manual", "auto"])),
  /** Renderer and builder for the preview; `react-vite` when absent. */
  framework: Schema.optional(FrameworkId),
  /**
   * Whether the tool writes to git: commits from the Changes panel, and `git init` in a folder
   * that is no repository. Off when absent. Off or on, a repository that is there is read: its
   * status, its diffs and its branch.
   */
  git: Schema.optional(GitWrites),
  /**
   * Writes a PNG of every page beside its file (`orders.page.png`), drawn again whenever the page,
   * its frame or the design system changes. Off when absent.
   */
  pagePngs: Schema.optional(Schema.Boolean),
  /**
   * The application (a package, relative to the repository): what the stylesheets' imports
   * resolve from, and a hint for the agents that implement. Absent means the designs directory
   * is itself a package.
   */
  resolveFrom: Schema.optional(RepoRelativePath),
  /** Which design skills agents are not told; all of them apply when absent. */
  skills: Schema.optional(SkillsConfig),
  /** Running Storybook for the design system, used for the Assets panel's previews. */
  storybookUrl: Schema.optional(Schema.String),
  /** What the tokens and classes are written in; `tailwind-v4` when absent (ADR 0024). */
  styleSystem: Schema.optional(StyleSystemId),
};

/** The settings the server runs with and the editor edits. Every path is resolved. */
export const Settings = Schema.Struct({
  ...common,
  /** Packages of components the application uses: a hint for the agents that implement. */
  componentPackages: Schema.Array(Schema.String),
  /** Directory holding the screens, relative to the repository. */
  designsDir: RepoRelativePath,
  /** The stylesheets the code's tokens are in, which Sync reads and writes (ADR 0028). */
  hostCss: Schema.Array(Schema.String),
  /**
   * Where the application's components are (relative to the repository): a hint for the agents
   * that implement (ADR 0040).
   */
  libraryDirs: Schema.Array(RepoRelativePath),
  /** Absolute path of the target repository. */
  repoPath: Schema.String,
  /** Value written to `data-theme` on the host document. */
  theme: Theme,
});
export type Settings = typeof Settings.Type;

/**
 * The same settings as they are written to disk: `ultrapaint.config.json` in a repository, or the
 * `settings.json` of a home directory. A file that lives in the repository is shared, so its
 * `repoPath` is relative to the file's directory and may be left out when it is that directory.
 * Everything with an obvious default may be left out of a hand-written file. A field that is no
 * setting any more (`providersModule`, which nothing draws since ADR 0040) is dropped as it is read.
 */
export const ProjectConfig = Schema.Struct({
  ...common,
  $schema: Schema.optional(Schema.String),
  componentPackages: Schema.optional(Schema.Array(Schema.String)),
  designsDir: RepoRelativePath,
  hostCss: Schema.optional(Schema.Array(Schema.String)),
  libraryDirs: Schema.optional(Schema.Array(RepoRelativePath)),
  repoPath: Schema.optional(Schema.String),
  theme: Schema.optional(Theme),
});
export type ProjectConfig = typeof ProjectConfig.Type;

/** File name looked for from the working directory upwards when no `--config` is given. */
export const CONFIG_FILE_NAME = "ultrapaint.config.json";

/** What the file was called before: still read, never written by a new save. */
export const LEGACY_CONFIG_FILE_NAME = "ultrapaint.json";

/** The names looked for in each directory, the one that wins first. */
export const CONFIG_FILE_NAMES = [
  CONFIG_FILE_NAME,
  LEGACY_CONFIG_FILE_NAME,
] as const;

/** Where pages go when the repository has no designs directory yet. */
export const DEFAULT_DESIGNS_DIR = "docs/designs";

export const defaultSettings = (repoPath: string): Settings => ({
  componentPackages: [],
  designsDir: DEFAULT_DESIGNS_DIR,
  hostCss: [],
  libraryDirs: [],
  repoPath,
  theme: "light",
});

export const SettingsValidation = Schema.Struct({
  branch: Schema.optional(Schema.String),
  ok: Schema.Boolean,
  problems: Schema.Array(Schema.String),
  repoName: Schema.optional(Schema.String),
});
export type SettingsValidation = typeof SettingsValidation.Type;

/**
 * Where the server keeps what it knows.
 * - `managed`: a home directory (`--home`) with its own settings file and state.
 * - `file`: a configuration file the user passed or that was found in the repository; the
 *   other state sits in a `.ultrapaint` directory next to it.
 * - `ephemeral`: started without a configuration; nothing outlives the process.
 */
export const StorageMode = Schema.Literals(["managed", "file", "ephemeral"]);
export type StorageMode = typeof StorageMode.Type;

export const StorageInfo = Schema.Struct({
  /** File the settings are read from and written to; absent when nothing is saved. */
  configPath: Schema.optional(Schema.String),
  /**
   * Folder the first-run setup should propose: the config's directory, or the git root around
   * the working directory, or the working directory when it is in no repository.
   */
  defaultRepoPath: Schema.optional(Schema.String),
  mode: StorageMode,
  /** An unsaved session the command keeps across restarts of the server, until it stops. */
  session: Schema.optional(Schema.Boolean),
});
export type StorageInfo = typeof StorageInfo.Type;

export const PersistInput = Schema.Struct({
  /** Absolute path of the configuration file to create. */
  configPath: Schema.String,
  /** Replace a file that is already there. */
  overwrite: Schema.optional(Schema.Boolean),
  settings: Settings,
});
export type PersistInput = typeof PersistInput.Type;

export const PersistResult = Schema.Struct({
  /** How to start the tool against the saved file next time. */
  command: Schema.optional(Schema.String),
  configPath: Schema.optional(Schema.String),
  validation: SettingsValidation,
});
export type PersistResult = typeof PersistResult.Type;

/**
 * Who the user is to the tool, wherever they work: kept in the user's own directory, never in a
 * project's configuration, which a team shares.
 */
export const UserProfile = Schema.Struct({
  /** Signs comments and draws the avatar when git gives no name. */
  displayName: Schema.optional(Schema.String),
});
export type UserProfile = typeof UserProfile.Type;
